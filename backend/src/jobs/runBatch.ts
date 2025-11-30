/**
 * Playlist Refresh Job - Stable Version
 */

import { DateTime } from 'luxon';
import path from 'path';
import { promises as fs } from 'fs';
import { randomUUID } from 'crypto';
import env from '../environments';
import supabase from '../services/supabaseClient';

// ============================================================================
// CONSTANTS
// ============================================================================

const TIMEZONE = 'Europe/Budapest';
const JOB_TABLE = 'refresh_jobs';
const PLAYLIST_TABLE = 'playlists';
const TRACKS_TABLE = 'tracks';
const YOUTUBE_API_BASE = 'https://www.googleapis.com/youtube/v3';
const YOUTUBE_PAGE_SIZE = 50;
const PLAYLIST_REFRESH_BATCH_SIZE = parseInt(process.env.PLAYLIST_REFRESH_BATCH_SIZE || '50', 10);
const MAX_RETRIES = 3;
const INITIAL_RETRY_DELAY_MS = 1000;
const BATCH_DIR = path.resolve(__dirname, '../../tmp/refresh_batches');
const DIAG_PREFIX = '[diag][runBatch]';
const MIX_PREFIX = 'RD';

// ============================================================================
// TYPES
// ============================================================================

export type JobStatus = 'pending' | 'running' | 'done' | 'error';
export type JobType = 'prepare' | 'run';

export type RefreshJobRow = {
  id: string;
  slot_index: number;
  type: JobType;
  scheduled_at: string;
  day_key: string;
  status: JobStatus;
  payload: Record<string, unknown> | null;
};

type PlaylistRow = {
  id: string;
  external_id: string | null;
  title: string;
  description: string | null;
  region: string | null;
  category: string | null;
  last_refreshed_on: string | null;
  last_etag: string | null;
  fetched_on: string | null;
  item_count: number | null;
};

type TrackRow = {
  id: string;
  playlist_id: string | null;
  youtube_id: string;
  external_id: string | null;
  title: string;
  artist: string;
  duration: number | null;
  cover_url: string | null;
  sync_status: string | null;
  last_synced_at: string | null;
  region: string | null;
  category: string | null;
};

type YouTubePlaylistItem = {
  videoId: string;
  title: string;
  channelTitle: string | null;
  thumbnailUrl: string | null;
  position: number;
};

type FetchPlaylistItemsResult = {
  items: YouTubePlaylistItem[];
  etag: string | null;
  unchanged: boolean; 
};

type BatchResult = {
  playlistCount: number;
  successCount: number;
  failureCount: number;
  skippedCount: number;
  errors: Array<{ playlistId: string; message: string }>;
};

type BatchFileEntry = {
  playlistId?: string;
  title?: string;
};

// ============================================================================
// HELPERS
// ============================================================================

function isMixPlaylist(youtubePlaylistId?: string | null): boolean {
  return Boolean(youtubePlaylistId && youtubePlaylistId.startsWith(MIX_PREFIX));
}

function diagLog(message: string, payload?: Record<string, unknown>): void {
  if (payload) console.log(DIAG_PREFIX, message, payload);
  else console.log(DIAG_PREFIX, message);
}

function maskApiKey(value?: string | null): string {
  if (!value) return 'unknown';
  return `${value.slice(0, 6)}...`;
}

function maskUrlApiKey(url: URL): string {
  const cloned = new URL(url.toString());
  const keyParam = cloned.searchParams.get('key');
  if (keyParam) cloned.searchParams.set('key', maskApiKey(keyParam));
  return cloned.toString();
}

function truncateBody(body: string, limit = 300): string {
  return body.length <= limit ? body : `${body.slice(0, limit)}…`;
}

type PlaylistUnavailableReason = 'notFound' | 'gone' | 'forbidden' | 'empty';

class PlaylistUnavailableError extends Error {
  status: number;
  reason: PlaylistUnavailableReason;
  constructor(status: number, reason: PlaylistUnavailableReason, message?: string) {
    super(message ?? 'Playlist unavailable');
    this.name = 'PlaylistUnavailableError';
    this.status = status;
    this.reason = reason;
  }
}

// ============================================================================
// MAIN JOB ENTRY
// ============================================================================

export async function executeRunJob(job: RefreshJobRow): Promise<void> {
  const scheduledLocal = DateTime.fromISO(job.scheduled_at, { zone: 'utc' }).setZone(TIMEZONE);

  console.log('[runBatch] Starting job', {
    jobId: job.id,
    type: job.type,
    slot: job.slot_index,
    scheduledAt: scheduledLocal.toISO(),
  });

  if (job.type !== 'run') {
    await finalizeJob(job.id, { error: `Unexpected job type ${job.type}` });
    return;
  }

  try {
    const result = await runBatchRefresh(job);
    await finalizeJob(job.id, result);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('[runBatch] Unexpected error', { jobId: job.id, error: message });
    await finalizeJob(job.id, { error: message });
  }
}

// ============================================================================
// BATCH REFRESH CORE
// ============================================================================

async function runBatchRefresh(job: RefreshJobRow): Promise<BatchResult> {
  const refreshSessionId = randomUUID();

  const { filePath, playlistIds } = await resolveBatchFile(job);
  const { playlists, mixSkipped } = await loadPlaylistsForRefresh(playlistIds);

  const result: BatchResult = {
    playlistCount: playlists.length,
    successCount: 0,
    failureCount: 0,
    skippedCount: mixSkipped,
    errors: [],
  };

  for (const playlist of playlists) {
    if (isMixPlaylist(playlist.external_id)) {
      result.skippedCount++;
      continue;
    }

    try {
      const skipped = await refreshSinglePlaylist(playlist);
      if (skipped) result.skippedCount++;
      else result.successCount++;
    } catch (err: unknown) {
      result.failureCount++;
      result.errors.push({
        playlistId: playlist.id,
        message: err instanceof Error ? err.message : 'Unknown',
      });
    }
  }

  return result;
}

async function resolveBatchFile(job: RefreshJobRow): Promise<{ filePath: string; playlistIds: string[] }> {
  const filePath = path.join(BATCH_DIR, `batch_${job.day_key}_slot_${job.slot_index}.json`);

  try {
    const raw = await fs.readFile(filePath, 'utf-8');
    const parsed = JSON.parse(raw) as BatchFileEntry[];
    const playlistIds = parsed
      .map(entry => entry.playlistId)
      .filter((id): id is string => Boolean(id));

    return { filePath, playlistIds };
  } catch {
    return { filePath, playlistIds: [] };
  }
}

async function loadPlaylistsForRefresh(requestedIds: string[]): Promise<{ playlists: PlaylistRow[]; mixSkipped: number }> {
  let mixSkipped = 0;

  if (requestedIds.length > 0) {
    const { data, error } = await supabase
      .from(PLAYLIST_TABLE)
      .select('*')
      .in('id', requestedIds);

    if (error) throw new Error(error.message);

    const rows = data || [];
    const filtered: PlaylistRow[] = [];

    for (const row of rows) {
      if (isMixPlaylist(row.external_id)) {
        mixSkipped++;
        continue;
      }
      filtered.push(row);
    }

    return { playlists: filtered, mixSkipped };
  }

  const { data, error } = await supabase
    .from(PLAYLIST_TABLE)
    .select('*')
    .order('last_refreshed_on', { ascending: true, nullsFirst: true })
    .limit(PLAYLIST_REFRESH_BATCH_SIZE);

  if (error) throw new Error(error.message);

  const fallback = data || [];
  const filtered: PlaylistRow[] = [];

  for (const row of fallback) {
    if (isMixPlaylist(row.external_id)) {
      mixSkipped++;
      continue;
    }
    filtered.push(row);
  }

  return { playlists: filtered, mixSkipped };
}

// ============================================================================
// SINGLE PLAYLIST REFRESH
// ============================================================================

async function refreshSinglePlaylist(playlist: PlaylistRow): Promise<boolean> {
  if (!playlist.external_id) return true;

  const youtubePlaylistId = playlist.external_id;

  if (!env.youtube_api_key) {
    throw new Error('Missing YOUTUBE_API_KEY');
  }

  let fetchResult: FetchPlaylistItemsResult;

  try {
    fetchResult = await fetchPlaylistItemsWithETag({
      apiKey: env.youtube_api_key,
      youtubePlaylistId,
      internalPlaylistId: playlist.id,
      lastEtag: playlist.last_etag,
    });
  } catch (error) {
    if (error instanceof PlaylistUnavailableError) {
      await removePlaylistFromDatabase(playlist, error);
      return false;
    }
    throw error;
  }

  const now = new Date().toISOString();

  if (fetchResult.unchanged) {
    await supabase.from(PLAYLIST_TABLE).update({ last_refreshed_on: now }).eq('id', playlist.id);
    return true;
  }

  await performDeltaSync(playlist, fetchResult.items, now);

  await supabase
    .from(PLAYLIST_TABLE)
    .update({
      last_refreshed_on: now,
      last_etag: fetchResult.etag,
      item_count: fetchResult.items.length,
    })
    .eq('id', playlist.id);

  return false;
}

// ============================================================================
// YOUTUBE FETCH LOGIC (unchanged stable version)
// ============================================================================

async function fetchPlaylistItemsWithETag(opts: {
  apiKey: string;
  youtubePlaylistId: string;
  internalPlaylistId: string;
  lastEtag?: string | null;
}): Promise<FetchPlaylistItemsResult> {
  const { apiKey, youtubePlaylistId, internalPlaylistId, lastEtag } = opts;

  const firstPage = await fetchPlaylistItemsPage({
    apiKey,
    playlistId: youtubePlaylistId,
    internalPlaylistId,
    lastEtag,
  });

  if (firstPage.status === 304) {
    return { items: [], etag: lastEtag ?? null, unchanged: true };
  }

  if (!firstPage.data) throw new Error('Failed first page');

  const items: YouTubePlaylistItem[] = parsePlaylistItemsPage(firstPage.data);
  let pageToken = firstPage.data.nextPageToken;
  let finalEtag = firstPage.etag;

  while (pageToken) {
    const page = await fetchPlaylistItemsPage({
      apiKey,
      playlistId: youtubePlaylistId,
      internalPlaylistId,
      pageToken,
    });

    if (!page.data) break;

    items.push(...parsePlaylistItemsPage(page.data));
    pageToken = page.data.nextPageToken;
  }

  if (items.length === 0) {
    throw new PlaylistUnavailableError(200, 'empty', `YouTube returned 0 items for playlist ${youtubePlaylistId}`);
  }

  return { items, etag: finalEtag, unchanged: false };
}

async function fetchPlaylistItemsPage(opts: {
  apiKey: string;
  playlistId: string;
  internalPlaylistId: string;
  pageToken?: string;
  lastEtag?: string | null;
}): Promise<{ status: number; data?: any; etag: string | null }> {
  const { apiKey, playlistId, pageToken, lastEtag } = opts;

  const url = new URL(`${YOUTUBE_API_BASE}/playlistItems`);
  url.searchParams.set('key', apiKey);
  url.searchParams.set('playlistId', playlistId);
  url.searchParams.set('part', 'contentDetails,snippet');
  url.searchParams.set('maxResults', YOUTUBE_PAGE_SIZE.toString());

  if (pageToken) url.searchParams.set('pageToken', pageToken);

  const headers: Record<string, string> = { 'Accept-Encoding': 'gzip' };
  if (lastEtag) headers['If-None-Match'] = lastEtag;

  const response = await fetch(url.toString(), { headers });

  if (response.status === 304) {
    return { status: 304, etag: lastEtag ?? null };
  }

  if (response.status === 200) {
    const data = await response.json();
    return { status: 200, data, etag: response.headers.get('etag') };
  }

  if (response.status === 404 || response.status === 410) {
    const body = await response.text();
    throw new PlaylistUnavailableError(
      response.status,
      response.status === 404 ? 'notFound' : 'gone',
      body
    );
  }

  if (response.status === 403) {
    const body = await response.text();
    throw new PlaylistUnavailableError(403, 'forbidden', body);
  }

  const text = await response.text();
  throw new Error(`YouTube error ${response.status}: ${text}`);
}

function parsePlaylistItemsPage(data: any): YouTubePlaylistItem[] {
  const items = Array.isArray(data?.items) ? data.items : [];
  const result: YouTubePlaylistItem[] = [];

  for (const item of items) {
    const videoId = item?.contentDetails?.videoId;
    const snippet = item?.snippet;
    if (!videoId || !snippet) continue;

    const title = snippet.title || 'Untitled track';
    if (title === 'Private video' || title === 'Deleted video') continue;

    result.push({
      videoId,
      title,
      channelTitle: snippet.channelTitle || null,
      thumbnailUrl: snippet.thumbnails?.default?.url || null,
      position: snippet.position ?? result.length,
    });
  }

  return result;
}

// ============================================================================
// DELTA SYNC — stable simple version
// ============================================================================

async function performDeltaSync(
  playlist: PlaylistRow,
  youtubeItems: YouTubePlaylistItem[],
  syncTimestamp: string
): Promise<void> {
  const externalIds = youtubeItems.map(x => x.videoId);

  const { data: existingTracks, error } = await supabase
    .from(TRACKS_TABLE)
    .select('*')
    .in('external_id', externalIds);

  if (error) throw new Error(error.message);

  const existing = (existingTracks || []) as TrackRow[];
  const existingMap = new Map(existing.map(t => [t.external_id, t]));

  const toInsert: any[] = [];
  const toUpdate: any[] = [];

  for (const item of youtubeItems) {
    const existingTrack = existingMap.get(item.videoId);

    if (!existingTrack) {
      toInsert.push({
        youtube_id: item.videoId,
        external_id: item.videoId,
        title: item.title,
        artist: item.channelTitle || 'Unknown Artist',
        cover_url: item.thumbnailUrl,
        sync_status: 'active',
        last_synced_at: syncTimestamp,
        region: playlist.region,
        category: playlist.category,
      });
    } else {
      const changed =
        existingTrack.title !== item.title ||
        existingTrack.artist !== (item.channelTitle || 'Unknown Artist') ||
        existingTrack.cover_url !== item.thumbnailUrl;

      if (changed || existingTrack.sync_status !== 'active') {
        toUpdate.push({
          id: existingTrack.id,
          updates: {
            title: item.title,
            artist: item.channelTitle || 'Unknown Artist',
            cover_url: item.thumbnailUrl,
            sync_status: 'active',
            last_synced_at: syncTimestamp,
          },
        });
      }
    }
  }

  // INSERT
  for (let i = 0; i < toInsert.length; i += 100) {
    const chunk = toInsert.slice(i, i + 100);
    const { error: insertError } = await supabase
      .from(TRACKS_TABLE)
      .upsert(chunk, { onConflict: 'external_id' });

    if (insertError) throw new Error(insertError.message);
  }

  // UPDATE
  for (const { id, updates } of toUpdate) {
    await supabase.from(TRACKS_TABLE).update(updates).eq('id', id);
  }
}

// ============================================================================
// FINALIZE
// ============================================================================

async function finalizeJob(jobId: string, payload: Record<string, unknown>): Promise<void> {
  await supabase.from(JOB_TABLE).update({ status: 'done', payload }).eq('id', jobId);
}

// ============================================================================
// REMOVE PLAYLIST
// ============================================================================

async function removePlaylistFromDatabase(playlist: PlaylistRow, errorObj: PlaylistUnavailableError): Promise<void> {
  // Just like stable version
  await supabase.from('playlist_tracks').delete().eq('playlist_id', playlist.id);
  await supabase.from('playlist_likes').delete().eq('playlist_id', playlist.id);
  await supabase.from('playlist_categories').delete().eq('playlist_id', playlist.id);
  await supabase.from('playlist_views').delete().eq('playlist_id', playlist.id);
  await supabase.from('likes').delete().eq('playlist_id', playlist.id);

  await supabase.from(TRACKS_TABLE).update({ playlist_id: null }).eq('playlist_id', playlist.id);

  await supabase.from(PLAYLIST_TABLE).delete().eq('id', playlist.id);
}
