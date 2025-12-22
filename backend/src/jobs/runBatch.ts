// backend/src/jobs/runBatch.ts

import { DateTime } from 'luxon';
import path from 'path';
import { promises as fs } from 'fs';
import { randomUUID } from 'crypto';
import env from '../environments';
import supabase from '../services/supabaseClient';
import { fetchChannelDetails, fetchChannelPlaylists, type ChannelPlaylist } from '../services/youtubeChannelService';
import { normalizeArtistKey } from '../utils/artistKey';

const TIMEZONE = 'Europe/Budapest';
const JOB_TABLE = 'refresh_jobs';
const PLAYLIST_TABLE = 'playlists';
const TRACKS_TABLE = 'tracks';
const PLAYLIST_TRACKS_TABLE = 'playlist_tracks';

const TRACK_SELECT_CHUNK_SIZE = 400;
const TRACK_UPSERT_CHUNK_SIZE = 200;
const PLAYLIST_TRACKS_CHUNK_SIZE = 500;

const PLAYLIST_REFRESH_BATCH_SIZE = parseInt(process.env.PLAYLIST_REFRESH_BATCH_SIZE || '50', 10);
const YOUTUBE_API_BASE = 'https://www.googleapis.com/youtube/v3';
const YOUTUBE_PAGE_SIZE = 50;
const PLAYLIST_TRACK_LIMIT = 500;
const PAGE_RETRY_ATTEMPTS = 3;
const PAGE_BACKOFF_MS = [1000, 2000, 4000];
const MIX_PREFIX = 'RD';
const BATCH_DIR = path.resolve(__dirname, '../../tmp/refresh_batches');
const DIAG_PREFIX = '[diag][runBatch]';

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
  channel_id?: string | null;
  channel_title?: string | null;
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

type TrackUpsertRecord = {
  youtube_id: string;
  external_id: string;
  title: string;
  artist: string;
  artist_channel_id: string | null;
  channel_title: string | null;
  cover_url: string | null;
  sync_status: 'active';
  last_synced_at: string;
  region: string | null;
  category: string | null;
};

type PlaylistTrackInsert = {
  playlist_id: string;
  track_id: string;
  position: number;
  added_at: string;
};

type YouTubePlaylistItem = {
  videoId: string;
  title: string;
  channelTitle: string | null;
  thumbnailUrl: string | null;
  position: number;
  videoOwnerChannelId?: string | null;
};

type FetchPlaylistItemsResult =
  | { state: 'unchanged'; etag: string | null; diagnostics: PlaylistRefreshDiagnostics }
  | { state: 'fetched'; etag: string | null; items: YouTubePlaylistItem[]; diagnostics: PlaylistRefreshDiagnostics };

type PlaylistRefreshDiagnostics = {
  partial_refresh: boolean;
  reason?:
    | 'etag-first-page'
    | 'etag-mid-page'
    | 'limit-500'
    | 'retry-failure'
    | 'invalid-playlist'
    | 'mix-playlist'
    | 'empty-playlist'
    | 'forbidden'
    | 'not-found'
    | 'gone';
  fetched_pages: number;
  fetched_items: number;
  etag_304_page?: number;
  retry_failure_page?: number;
  total_available?: number | null;
  logged_overflow?: boolean;
};

type BatchResult = {
  playlistCount: number;
  successCount: number;
  failureCount: number;
  skippedCount: number;
  errors: Array<{ playlistId: string; message: string }>;
  diagnostics: Record<string, PlaylistRefreshDiagnostics>;
};

type BatchFileEntry = {
  playlistId?: string;
  channelId?: string;
  artist?: string;
  title?: string;
};

type PlaylistUnavailableReason = 'notFound' | 'gone' | 'forbidden' | 'empty' | 'invalid';

type PlaylistItemsResponse = {
  items?: Array<{
    contentDetails?: { videoId?: string };
    snippet?: {
      title?: string;
      channelTitle?: string;
      thumbnails?: { default?: { url?: string } };
      position?: number;
    };
  }>;
  nextPageToken?: string;
  pageInfo?: { totalResults?: number | null };
  etag?: string;
};

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

class PageRetryError extends Error {
  pageNumber: number;

  constructor(pageNumber: number, message: string) {
    super(message);
    this.name = 'PageRetryError';
    this.pageNumber = pageNumber;
  }
}

function diagLog(message: string, payload?: Record<string, unknown>): void {
  if (payload) {
    console.log(DIAG_PREFIX, message, payload);
  } else {
    console.log(DIAG_PREFIX, message);
  }
}

function isMixPlaylist(youtubePlaylistId?: string | null): boolean {
  return Boolean(youtubePlaylistId && youtubePlaylistId.startsWith(MIX_PREFIX));
}

function isValidYouTubePlaylistId(value?: string | null): boolean {
  if (!value) return false;
  return /^[A-Za-z0-9_-]{16,}$/.test(value);
}

function maskApiKey(value?: string | null): string {
  if (!value || value.length === 0) {
    return 'unknown';
  }
  return `${value.slice(0, 6)}...`;
}

function maskUrlApiKey(url: URL): string {
  const sanitized = new URL(url.toString());
  const key = sanitized.searchParams.get('key');
  if (key) {
    sanitized.searchParams.set('key', maskApiKey(key));
  }
  return sanitized.toString();
}

function truncateBody(body: string, limit = 300): string {
  if (body.length <= limit) return body;
  return `${body.slice(0, limit)}…`;
}

export async function executeRunJob(job: RefreshJobRow): Promise<void> {
  const scheduledLocal = DateTime.fromISO(job.scheduled_at, { zone: 'utc' }).setZone(TIMEZONE);
  console.log('[runBatch] Starting job', {
    jobId: job.id,
    type: job.type,
    slot: job.slot_index,
    scheduledAt: scheduledLocal.toISO(),
  });

  if (!supabase) {
    console.error('[runBatch] Supabase client unavailable');
    await finalizeJob(job.id, { error: 'Supabase client unavailable' });
    return;
  }

  if (job.type !== 'run') {
    console.warn('[runBatch] Wrong job type', { jobId: job.id, type: job.type });
    await finalizeJob(job.id, { error: `Unexpected job type ${job.type}` });
    return;
  }

  try {
    const result = await runBatchRefresh(job);
    await finalizeJob(job.id, result);
    console.log('[runBatch] Job completed', {
      jobId: job.id,
      success: result.successCount,
      failure: result.failureCount,
      skipped: result.skippedCount,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('[runBatch] Job failed', { jobId: job.id, message });
    await finalizeJob(job.id, { error: message });
  }
}

async function runBatchRefresh(job: RefreshJobRow): Promise<BatchResult> {
  const refreshSessionId = randomUUID();
  diagLog('runBatchRefresh.start', {
    refreshSessionId,
    jobId: job.id,
    slot: job.slot_index,
    dayKey: job.day_key,
  });

  const { playlistIds, channelIds } = await resolveBatchFile(job);

  if (channelIds.length > 0) {
    return await runChannelBatch(channelIds, job, refreshSessionId);
  }

  const { playlists, mixSkipped } = await loadPlaylistsForRefresh(playlistIds);

  const result: BatchResult = {
    playlistCount: playlists.length,
    successCount: 0,
    failureCount: 0,
    skippedCount: mixSkipped,
    errors: [],
    diagnostics: {},
  };

  for (const playlist of playlists) {
    const diagnostics: PlaylistRefreshDiagnostics = {
      partial_refresh: false,
      fetched_pages: 0,
      fetched_items: 0,
      total_available: null,
    };

    try {
      const skipped = await refreshSinglePlaylist(playlist, diagnostics);
      result.diagnostics[playlist.id] = { ...diagnostics };
      if (skipped) {
        result.skippedCount += 1;
      } else {
        result.successCount += 1;
      }
    } catch (error) {
      result.diagnostics[playlist.id] = { ...diagnostics };
      result.failureCount += 1;
      const message = error instanceof Error ? error.message : 'Unknown playlist refresh error';
      result.errors.push({ playlistId: playlist.id, message });
      console.error('[runBatch] Playlist refresh failed', {
        playlistId: playlist.id,
        youtubePlaylistId: playlist.external_id,
        message,
      });
    }
  }

  diagLog('runBatchRefresh.complete', {
    refreshSessionId,
    resultSummary: {
      success: result.successCount,
      failure: result.failureCount,
      skipped: result.skippedCount,
    },
  });
  return result;
}

async function runChannelBatch(channelIds: string[], job: RefreshJobRow, refreshSessionId: string): Promise<BatchResult> {
  const result: BatchResult = {
    playlistCount: 0,
    successCount: 0,
    failureCount: 0,
    skippedCount: 0,
    errors: [],
    diagnostics: {},
  };

  for (const channelId of channelIds) {
    try {
      const channel = await fetchChannelDetails(channelId, env.youtube_api_key);
      await upsertArtistFromChannel(channel);

      const playlists = await fetchChannelPlaylists(channelId, env.youtube_api_key);
      if (playlists.length === 0) {
        diagLog('runChannelBatch.noPlaylists', { channelId });
        continue;
      }

      const now = new Date().toISOString();
      const playlistRows = await upsertChannelPlaylists(playlists, channel.title, now);
      result.playlistCount += playlistRows.length;

      for (const playlist of playlistRows) {
        if (isMixPlaylist(playlist.external_id)) {
          result.skippedCount += 1;
          continue;
        }

        const diagnostics: PlaylistRefreshDiagnostics = {
          partial_refresh: false,
          fetched_pages: 0,
          fetched_items: 0,
          total_available: null,
        };

        try {
          const skipped = await refreshSinglePlaylist(playlist, diagnostics);
          result.diagnostics[playlist.id] = { ...diagnostics };
          if (skipped) result.skippedCount += 1;
          else result.successCount += 1;
        } catch (error) {
          result.diagnostics[playlist.id] = { ...diagnostics };
          result.failureCount += 1;
          const message = error instanceof Error ? error.message : 'Unknown playlist refresh error';
          result.errors.push({ playlistId: playlist.id, message });
          console.error('[runBatch] Playlist refresh failed', {
            playlistId: playlist.id,
            youtubePlaylistId: playlist.external_id,
            message,
            channelId,
          });
        }
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown channel error';
      result.errors.push({ playlistId: channelId, message });
      result.failureCount += 1;
      console.error('[runBatch] Channel processing failed', { channelId, message, refreshSessionId });
    }
  }

  return result;
}

async function upsertArtistFromChannel(channel: { id: string; title: string; thumbnailUrl?: string | null; bannerUrl?: string | null; subscribers?: number | null; views?: number | null; country?: string | null }): Promise<void> {
  if (!supabase) throw new Error('Supabase client unavailable');

  const payload = {
    artist: channel.title,
    artist_key: normalizeArtistKey(channel.title),
    youtube_channel_id: channel.id,
    thumbnail_url: channel.thumbnailUrl ?? null,
    banner_url: channel.bannerUrl ?? null,
    subscribers: channel.subscribers ?? null,
    views: channel.views ?? null,
    country: channel.country ?? null,
    source: 'youtube',
  } as const;

  const { error } = await supabase
    .from('artists')
    .upsert(payload, { onConflict: 'youtube_channel_id' });

  if (error) {
    throw new Error(`Failed to upsert artist ${channel.id}: ${error.message}`);
  }
}

async function upsertChannelPlaylists(playlists: ChannelPlaylist[], fallbackChannelTitle: string, nowIso: string): Promise<PlaylistRow[]> {
  if (!supabase) throw new Error('Supabase client unavailable');

  const payload = playlists.map(p => ({
    external_id: p.id,
    title: p.title,
    description: p.description ?? null,
    channel_id: p.channelId,
    channel_title: p.channelTitle ?? fallbackChannelTitle ?? null,
    cover_url: p.thumbnailUrl ?? null,
    item_count: p.itemCount ?? null,
    last_etag: p.etag ?? null,
    fetched_on: nowIso,
    last_refreshed_on: nowIso,
  }));

  const { data, error } = await supabase
    .from(PLAYLIST_TABLE)
    .upsert(payload, { onConflict: 'external_id' })
    .select('id, external_id, title, description, channel_id, channel_title, region, category, last_refreshed_on, last_etag, fetched_on, item_count');

  if (error) {
    throw new Error(`Failed to upsert playlists: ${error.message}`);
  }

  return Array.isArray(data) ? (data as PlaylistRow[]) : [];
}

async function resolveBatchFile(job: RefreshJobRow): Promise<{ filePath: string; playlistIds: string[]; channelIds: string[] }> {
  const filePath = path.join(BATCH_DIR, `batch_${job.day_key}_slot_${job.slot_index}.json`);
  try {
    const raw = await fs.readFile(filePath, 'utf-8');
    const parsed = JSON.parse(raw) as BatchFileEntry[];
    const playlistIds = Array.isArray(parsed)
      ? parsed.map(entry => entry?.playlistId).filter((id): id is string => Boolean(id))
      : [];
    const channelIds = Array.isArray(parsed)
      ? parsed.map(entry => entry?.channelId).filter((id): id is string => Boolean(id))
      : [];
    diagLog('resolveBatchFile.success', { filePath, playlistIdsCount: playlistIds.length, channelIdsCount: channelIds.length });
    return { filePath, playlistIds, channelIds };
  } catch (error) {
    diagLog('resolveBatchFile.miss', { filePath, error: error instanceof Error ? error.message : String(error) });
    return { filePath, playlistIds: [], channelIds: [] };
  }
}

async function loadPlaylistsForRefresh(
  requestedIds?: string[],
): Promise<{ playlists: PlaylistRow[]; mixSkipped: number }> {
  let mixSkipped = 0;
  let rows: PlaylistRow[] = [];

  if (requestedIds && requestedIds.length > 0) {
    const { data, error } = await supabase!
      .from(PLAYLIST_TABLE)
      .select(
        'id, external_id, title, description, channel_id, channel_title, region, category, last_refreshed_on, last_etag, fetched_on, item_count',
      )
      .in('id', requestedIds);

    if (error) {
      throw new Error(`Failed to load playlists: ${error.message}`);
    }

    const map = new Map((data || []).map(row => [row.id, row as PlaylistRow]));
    rows = requestedIds.map(id => map.get(id)).filter((row): row is PlaylistRow => Boolean(row));
  } else {
    const { data, error } = await supabase!
      .from(PLAYLIST_TABLE)
      .select(
        'id, external_id, title, description, channel_id, channel_title, region, category, last_refreshed_on, last_etag, fetched_on, item_count',
      )
      .order('last_refreshed_on', { ascending: true, nullsFirst: true })
      .limit(PLAYLIST_REFRESH_BATCH_SIZE);

    if (error) {
      throw new Error(`Failed to load playlists: ${error.message}`);
    }

    rows = (data as PlaylistRow[]) || [];
  }

  const playlists: PlaylistRow[] = [];
  for (const row of rows) {
    if (isMixPlaylist(row.external_id)) {
      mixSkipped += 1;
      continue;
    }
    playlists.push(row);
  }

  return { playlists, mixSkipped };
}

async function refreshSinglePlaylist(
  playlist: PlaylistRow,
  diagnostics: PlaylistRefreshDiagnostics,
): Promise<boolean> {
  if (!playlist.external_id) {
    diagnostics.reason = 'invalid-playlist';
    return true;
  }

  if (!isValidYouTubePlaylistId(playlist.external_id)) {
    diagnostics.reason = 'invalid-playlist';
    diagLog('refreshSinglePlaylist.invalidId', {
      playlistId: playlist.id,
      youtubePlaylistId: playlist.external_id,
    });
    return true;
  }

  if (isMixPlaylist(playlist.external_id)) {
    diagnostics.reason = 'mix-playlist';
    return true;
  }

  if (!env.youtube_api_key) {
    throw new Error('YOUTUBE_API_KEY not configured');
  }

  let fetchResult: FetchPlaylistItemsResult;
  try {
    fetchResult = await paginatePlaylistItems({
      playlist,
      diagnostics,
      apiKey: env.youtube_api_key,
    });
  } catch (error) {
    if (error instanceof PlaylistUnavailableError) {
      diagnostics.reason = diagnostics.reason ?? mapPlaylistUnavailableReason(error.reason);
      await removePlaylistFromDatabase(playlist, error);
      return false;
    }
    throw error;
  }

  const now = new Date().toISOString();

  if (fetchResult.state === 'unchanged') {
    await supabase!
      .from(PLAYLIST_TABLE)
      .update({ last_refreshed_on: now })
      .eq('id', playlist.id);

    return true;
  }

  if (fetchResult.items.length === 0) {
    diagnostics.reason = 'empty-playlist';
    throw new PlaylistUnavailableError(200, 'empty', `Playlist ${playlist.external_id} returned 0 items`);
  }

  // FULL REBUILD: upsert tracks + full replace playlist_tracks
  await syncPlaylistTracksFull(playlist, fetchResult.items, now);

  await supabase!
    .from(PLAYLIST_TABLE)
    .update({
      last_refreshed_on: now,
      last_etag: fetchResult.etag,
      item_count: fetchResult.items.length,
    })
    .eq('id', playlist.id);

  return false;
}

async function paginatePlaylistItems(opts: {
  playlist: PlaylistRow;
  diagnostics: PlaylistRefreshDiagnostics;
  apiKey: string;
}): Promise<FetchPlaylistItemsResult> {
  const { playlist, diagnostics, apiKey } = opts;
  const youtubePlaylistId = playlist.external_id!;

  const aggregated: YouTubePlaylistItem[] = [];
  let pageToken: string | undefined;
  let currentPage = 1;
  let etagToSend: string | null = playlist.last_etag || null;
  let finalEtag: string | null = playlist.last_etag || null;
  let overflowLogged = false;

  while (true) {
    let page;
    try {
      page = await fetchPlaylistPageStrict({
        apiKey,
        playlistId: youtubePlaylistId,
        internalPlaylistId: playlist.id,
        pageToken,
        ifNoneMatch: etagToSend,
        pageNumber: currentPage,
      });
    } catch (error) {
      if (error instanceof PageRetryError) {
        diagnostics.reason = 'retry-failure';
        diagnostics.retry_failure_page = error.pageNumber;
      }
      throw error;
    }

    if (page.status === 304) {
      diagnostics.etag_304_page = currentPage;
      diagnostics.reason = currentPage === 1 ? 'etag-first-page' : 'etag-mid-page';
      if (currentPage === 1) {
        return {
          state: 'unchanged',
          etag: etagToSend,
          diagnostics: { ...diagnostics },
        };
      }
      break;
    }

    if (!page.data) {
      throw new Error('YouTube API returned empty body');
    }

    finalEtag = page.etag ?? finalEtag;
    diagnostics.fetched_pages += 1;

    if (diagnostics.total_available == null && typeof page.data?.pageInfo?.totalResults === 'number') {
      diagnostics.total_available = page.data.pageInfo.totalResults;
    }

    if (!overflowLogged && (diagnostics.total_available || 0) > PLAYLIST_TRACK_LIMIT) {
      overflowLogged = true;
      diagnostics.logged_overflow = true;
      console.warn('[runBatch] Playlist exceeds 500 tracks, truncating refresh', {
        playlistId: playlist.id,
        youtubePlaylistId,
        totalResults: diagnostics.total_available,
      });
    }

    const parsed = parsePlaylistItemsPage(page.data);

    const remainingSlots = PLAYLIST_TRACK_LIMIT - aggregated.length;
    if (remainingSlots <= 0) {
      diagnostics.partial_refresh = true;
      diagnostics.reason = 'limit-500';
      break;
    }

    aggregated.push(...parsed.slice(0, remainingSlots));
    diagnostics.fetched_items = aggregated.length;

    if (aggregated.length >= PLAYLIST_TRACK_LIMIT) {
      diagnostics.partial_refresh = true;
      diagnostics.reason = 'limit-500';
      console.warn('[runBatch] Hard stop at 500 tracks', {
        playlistId: playlist.id,
        youtubePlaylistId,
        fetchedItems: aggregated.length,
      });
      break;
    }

    if (!page.data.nextPageToken) {
      break;
    }

    pageToken = page.data.nextPageToken;
    currentPage += 1;
    etagToSend = finalEtag;
  }

  if (aggregated.length === 0) {
    diagnostics.reason = 'empty-playlist';
    throw new PlaylistUnavailableError(200, 'empty', `YouTube returned 0 items for playlist ${youtubePlaylistId}`);
  }

  return {
    state: 'fetched',
    etag: finalEtag,
    items: aggregated,
    diagnostics: { ...diagnostics },
  };
}

type PlaylistPageResponse =
  | { status: 304; data?: undefined; etag: string | null }
  | { status: 200; data: PlaylistItemsResponse; etag: string | null };

async function fetchPlaylistPageStrict(opts: {
  apiKey: string;
  playlistId: string;
  internalPlaylistId: string;
  pageToken?: string;
  ifNoneMatch?: string | null;
  pageNumber: number;
}): Promise<PlaylistPageResponse> {
  const { apiKey, playlistId, internalPlaylistId, pageToken, ifNoneMatch, pageNumber } = opts;

  const url = new URL(`${YOUTUBE_API_BASE}/playlistItems`);
  url.searchParams.set('key', apiKey);
  url.searchParams.set('playlistId', playlistId);
  url.searchParams.set('part', 'contentDetails,snippet');
  url.searchParams.set(
    'fields',
    'items(contentDetails/videoId,snippet(title,channelTitle,videoOwnerChannelId,thumbnails/default/url,position)),nextPageToken,pageInfo,etag',
  );
  url.searchParams.set('maxResults', YOUTUBE_PAGE_SIZE.toString());
  if (pageToken) {
    url.searchParams.set('pageToken', pageToken);
  }

  const headers: Record<string, string> = {
    'Accept-Encoding': 'gzip',
  };

  if (ifNoneMatch) {
    headers['If-None-Match'] = ifNoneMatch;
  }

  let lastError: Error | null = null;

  for (let attempt = 1; attempt <= PAGE_RETRY_ATTEMPTS; attempt += 1) {
    try {
      assertNoSearchList(url);
      diagLog('fetchPlaylistPageStrict.request', {
        playlistId: internalPlaylistId,
        youtubePlaylistId: playlistId,
        pageNumber,
        attempt,
        url: maskUrlApiKey(url),
        headers,
      });

      const response = await fetch(url.toString(), { headers });
      const etag = response.headers.get('etag');
      logQuotaUsage({
        playlistId: internalPlaylistId,
        youtubePlaylistId: playlistId,
        status: response.status,
        endpoint: 'playlistItems.list',
        quotaHeader: response.headers.get('x-goog-quota-used'),
      });

      if (response.status === 304) {
        diagLog('fetchPlaylistPageStrict.http304', {
          playlistId: internalPlaylistId,
          youtubePlaylistId: playlistId,
          pageNumber,
          attempt,
        });
        return { status: 304, etag: etag || ifNoneMatch || null };
      }

      if (response.status === 200) {
        const data = await response.json();
        diagLog('fetchPlaylistPageStrict.success', {
          playlistId: internalPlaylistId,
          youtubePlaylistId: playlistId,
          pageNumber,
          attempt,
          nextPageToken: data?.nextPageToken ?? null,
        });
        return { status: 200, data, etag: etag || null };
      }

      if (response.status === 400) {
        const text = await response.text();
        throw new PlaylistUnavailableError(400, 'invalid', text);
      }

      if (response.status === 403) {
        const text = await response.text();
        throw new PlaylistUnavailableError(403, 'forbidden', text);
      }

      if (response.status === 404) {
        const text = await response.text();
        throw new PlaylistUnavailableError(404, 'notFound', text);
      }

      if (response.status === 410) {
        const text = await response.text();
        throw new PlaylistUnavailableError(410, 'gone', text);
      }

      if (response.status >= 500 && response.status < 600) {
        lastError = new Error(`YouTube API ${response.status}`);
        if (attempt < PAGE_RETRY_ATTEMPTS) {
          await sleep(PAGE_BACKOFF_MS[attempt - 1] || PAGE_BACKOFF_MS[PAGE_BACKOFF_MS.length - 1]);
          continue;
        }
        throw new PageRetryError(pageNumber, lastError.message);
      }

      const errorBody = await response.text();
      throw new Error(`YouTube API error ${response.status}: ${truncateBody(errorBody)}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const retryable = shouldRetryNetworkError(message);
      if (retryable && attempt < PAGE_RETRY_ATTEMPTS) {
        await sleep(PAGE_BACKOFF_MS[attempt - 1] || PAGE_BACKOFF_MS[PAGE_BACKOFF_MS.length - 1]);
        continue;
      }
      if (retryable) {
        throw new PageRetryError(pageNumber, message);
      }
      throw error;
    }
  }

  throw lastError || new Error('Unknown pagination failure');
}

function parsePlaylistItemsPage(data: PlaylistItemsResponse): YouTubePlaylistItem[] {
  const items = Array.isArray(data?.items) ? data.items : [];
  const result: YouTubePlaylistItem[] = [];

  for (const raw of items) {
    const videoId = raw?.contentDetails?.videoId;
    const snippet = raw?.snippet;
    if (!videoId || !snippet) continue;
    const title = snippet.title || 'Untitled track';
    if (title === 'Private video' || title === 'Deleted video') {
      continue;
    }
    result.push({
      videoId,
      title,
      channelTitle: snippet.channelTitle || null,
      thumbnailUrl: snippet.thumbnails?.default?.url || null,
      position: typeof snippet.position === 'number' ? snippet.position : result.length,
      videoOwnerChannelId: (snippet as any)?.videoOwnerChannelId ?? null,
    });
  }

  return result;
}

function shouldRetryNetworkError(message: string): boolean {
  const lowered = message.toLowerCase();
  return (
    lowered.includes('network') ||
    lowered.includes('econnreset') ||
    lowered.includes('timed out') ||
    lowered.includes('fetch failed')
  );
}

/**
 * FULL REBUILD (fetchTracks.js stil):
 * - upsertuje sve pesme u `tracks` (po external_id)
 * - briše stare redove iz `playlist_tracks` za tu playlistu
 * - ubacuje NOVE redove u `playlist_tracks` po trenutnom redosledu
 * - deduplikuje (playlist_id, track_id) da ne lupa u UNIQUE indexe
 */
async function syncPlaylistTracksFull(
  playlist: PlaylistRow,
  youtubeItems: YouTubePlaylistItem[],
  syncTimestamp: string,
): Promise<void> {
  if (youtubeItems.length === 0) return;

  // 1) Upsert tracks — prvo deduplikacija po external_id
  const rawTrackRecords: TrackUpsertRecord[] = youtubeItems.map(item => ({
    youtube_id: item.videoId,
    external_id: item.videoId,
    title: item.title,
    artist: item.channelTitle || 'Unknown Artist',
    artist_channel_id: item.videoOwnerChannelId ?? playlist.channel_id ?? null,
    channel_title: playlist.channel_title ?? item.channelTitle ?? null,
    cover_url: item.thumbnailUrl,
    sync_status: 'active',
    last_synced_at: syncTimestamp,
    region: playlist.region,
    category: playlist.category,
  }));

  // ❗ bitno: jedan external_id = jedan red u upsertu
  const trackMap = new Map<string, TrackUpsertRecord>();
  for (const rec of rawTrackRecords) {
    if (!trackMap.has(rec.external_id)) {
      trackMap.set(rec.external_id, rec);
    }
    // ako već postoji, ostavljamo prvi viđeni – svejedno je, jer su to isti videoId
  }
  const trackRecords = Array.from(trackMap.values());

  const upsertChunks = chunkArray(trackRecords, TRACK_UPSERT_CHUNK_SIZE);
  for (const chunk of upsertChunks) {
    const { error } = await supabase!
      .from(TRACKS_TABLE)
      .upsert(chunk, { onConflict: 'external_id' });

    if (error) {
      throw new Error(`Failed to upsert tracks: ${error.message}`);
    }
  }

  // 2) Map external_id -> track_id
  const externalIds = Array.from(new Set(youtubeItems.map(i => i.videoId).filter(Boolean)));
  const idMap = new Map<string, string>();

  const selectChunks = chunkArray(externalIds, TRACK_SELECT_CHUNK_SIZE);
  for (const chunk of selectChunks) {
    const { data, error } = await supabase!
      .from(TRACKS_TABLE)
      .select('id, external_id')
      .in('external_id', chunk);

    if (error) {
      throw new Error(`Failed to load track IDs: ${error.message}`);
    }

    for (const row of (data as { id: string; external_id: string }[]) || []) {
      if (row.external_id) {
        idMap.set(row.external_id, row.id);
      }
    }
  }

  // 3) Očistimo stare playlist_tracks za ovu playlistu
  const { error: deleteError } = await supabase!
    .from(PLAYLIST_TRACKS_TABLE)
    .delete()
    .eq('playlist_id', playlist.id);

  if (deleteError) {
    throw new Error(`Failed to clear playlist_tracks: ${deleteError.message}`);
  }

  // 4) Napravimo nove playlist_tracks redove po trenutnom redosledu
  const linkRows: PlaylistTrackInsert[] = [];
  youtubeItems.forEach((item, index) => {
    const trackId = idMap.get(item.videoId);
    if (!trackId) return;
    const position = typeof item.position === 'number' ? item.position + 1 : index + 1;
    linkRows.push({
      playlist_id: playlist.id,
      track_id: trackId,
      position,
      added_at: syncTimestamp,
    });
  });

  if (linkRows.length === 0) {
    console.warn('[runBatch] No playlist_tracks rows built after sync', {
      playlistId: playlist.id,
      youtubePlaylistId: playlist.external_id,
    });
    return;
  }

  // ❗ DEDUPE po (playlist_id, track_id) da ne pucaju UNIQUE indexi
  const dedupeMap = new Map<string, PlaylistTrackInsert>();
  for (const row of linkRows) {
    const key = `${row.playlist_id}::${row.track_id}`;
    const existing = dedupeMap.get(key);
    if (!existing || row.position < existing.position) {
      dedupeMap.set(key, row);
    }
  }
  const dedupedLinkRows = Array.from(dedupeMap.values());

  const playlistTrackChunks = chunkArray(dedupedLinkRows, PLAYLIST_TRACKS_CHUNK_SIZE);
  for (const chunk of playlistTrackChunks) {
    const { error } = await supabase!
      .from(PLAYLIST_TRACKS_TABLE)
      .insert(chunk);

    if (error) {
      throw new Error(`Failed to insert playlist_tracks: ${error.message}`);
    }
  }
}

function chunkArray<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }
  return chunks;
}

function assertNoSearchList(url: URL): void {
  if (url.pathname.includes('/search') || url.toString().includes('search?')) {
    throw new Error('search.list detected');
  }
}

function logQuotaUsage(opts: {
  playlistId: string;
  youtubePlaylistId: string;
  status: number;
  endpoint: string;
  quotaHeader: string | null;
}): void {
  const { playlistId, youtubePlaylistId, status, endpoint, quotaHeader } = opts;
  console.log('[quota]', {
    playlistId,
    youtubePlaylistId,
    status,
    endpoint,
    quota: quotaHeader || 'n/a',
  });
}

function mapPlaylistUnavailableReason(reason: PlaylistUnavailableReason): PlaylistRefreshDiagnostics['reason'] {
  switch (reason) {
    case 'empty':
      return 'empty-playlist';
    case 'forbidden':
      return 'forbidden';
    case 'notFound':
      return 'not-found';
    case 'gone':
      return 'gone';
    case 'invalid':
    default:
      return 'invalid-playlist';
  }
}

async function finalizeJob(jobId: string, payload: Record<string, unknown>): Promise<void> {
  const { error } = await supabase!
    .from(JOB_TABLE)
    .update({ status: 'done', payload })
    .eq('id', jobId);
  if (error) {
    console.error('[runBatch] Failed to update job status', { jobId, error: error.message });
  }
}

async function removePlaylistFromDatabase(playlist: PlaylistRow, reason: PlaylistUnavailableError): Promise<void> {
  const { error: ptError } = await supabase!
    .from('playlist_tracks')
    .delete()
    .eq('playlist_id', playlist.id);
  if (ptError) throw new Error(`Failed to delete playlist_tracks: ${ptError.message}`);

  const { error: plError } = await supabase!
    .from('playlist_likes')
    .delete()
    .eq('playlist_id', playlist.id);
  if (plError) throw new Error(`Failed to delete playlist_likes: ${plError.message}`);

  const { error: pcError } = await supabase!
    .from('playlist_categories')
    .delete()
    .eq('playlist_id', playlist.id);
  if (pcError) throw new Error(`Failed to delete playlist_categories: ${pcError.message}`);

  const { error: pvError } = await supabase!
    .from('playlist_views')
    .delete()
    .eq('playlist_id', playlist.id);
  if (pvError) throw new Error(`Failed to delete playlist_views: ${pvError.message}`);

  const { error: likesError } = await supabase!
    .from('likes')
    .delete()
    .eq('playlist_id', playlist.id);
  if (likesError) throw new Error(`Failed to delete likes: ${likesError.message}`);

  const { error: tracksUpdateError } = await supabase!
    .from(TRACKS_TABLE)
    .update({ playlist_id: null })
    .eq('playlist_id', playlist.id);
  if (tracksUpdateError) throw new Error(`Failed to detach tracks: ${tracksUpdateError.message}`);

  const { error: playlistError } = await supabase!
    .from(PLAYLIST_TABLE)
    .delete()
    .eq('id', playlist.id);
  if (playlistError) throw new Error(`Failed to delete playlist: ${playlistError.message}`);

  console.warn('[runBatch] Removed playlist due to unavailability', {
    playlistId: playlist.id,
    youtubePlaylistId: playlist.external_id,
    reason: reason.reason,
    status: reason.status,
  });
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}
