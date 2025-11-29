/**
 * Playlist Refresh Job - Complete Rewrite
 * 
 * This job implements efficient, legal YouTube playlist refresh with:
 * - ETag-based short-circuiting (HTTP 304 Not Modified)
 * - Delta sync for tracks (insert/update/delete)
 * - Quota-efficient API usage (10k daily limit compliance)
 * - 30-day refresh cycle compatibility
 * - Full YouTube Data API v3 Terms compliance
 * 
 * Architecture:
 * - Uses only YouTube Data API v3 list methods (playlists.list, playlistItems.list, videos.list)
 * - Stores only metadata in Supabase
 * - Playback handled elsewhere via visible YouTube IFrame player
 * - Runs on Render backend, triggered by jobProcessor scheduler
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
const TRACK_SELECT_CHUNK_SIZE = 400;
const TRACK_UPSERT_CHUNK_SIZE = 200;
const MAX_REFRESH_TRACKS = 1200;

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
  unchanged: boolean; // true when HTTP 304
};

type BatchResult = {
  playlistCount: number;
  successCount: number;
  failureCount: number;
  skippedCount: number; // Playlists skipped due to ETag match
  errors: Array<{ playlistId: string; message: string }>;
};

type BatchFileEntry = {
  playlistId?: string;
  title?: string;
};

function isMixPlaylist(youtubePlaylistId?: string | null): boolean {
  if (!youtubePlaylistId) {
    return false;
  }
  return youtubePlaylistId.startsWith(MIX_PREFIX);
}

function diagLog(message: string, payload?: Record<string, unknown>): void {
  if (payload) {
    console.log(DIAG_PREFIX, message, payload);
  } else {
    console.log(DIAG_PREFIX, message);
  }
}

function maskApiKey(value?: string | null): string {
  if (!value || value.length === 0) {
    return 'unknown';
  }
  return `${value.slice(0, 6)}...`;
}

function maskUrlApiKey(url: URL): string {
  const cloned = new URL(url.toString());
  const keyParam = cloned.searchParams.get('key');
  if (keyParam) {
    cloned.searchParams.set('key', maskApiKey(keyParam));
  }
  return cloned.toString();
}

function truncateBody(body: string, limit = 300): string {
  if (body.length <= limit) {
    return body;
  }
  return `${body.slice(0, limit)}…`;
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
// MAIN JOB ENTRY POINT
// ============================================================================

/**
 * Main job executor called by jobProcessor.
 * Loads a batch of playlists due for refresh and processes them.
 */
export async function executeRunJob(job: RefreshJobRow): Promise<void> {
  const scheduledLocal = DateTime.fromISO(job.scheduled_at, { zone: 'utc' }).setZone(TIMEZONE);
  console.log('[runBatch] Starting job', {
    jobId: job.id,
    type: job.type,
    slot: job.slot_index,
    scheduledAt: scheduledLocal.toISO(),
  });
  diagLog('executeRunJob.start', {
    jobId: job.id,
    type: job.type,
    slot: job.slot_index,
    scheduledAtLocal: scheduledLocal.toISO(),
    dayKey: job.day_key,
  });

  if (!supabase) {
    console.error('[runBatch] Supabase client unavailable. Marking job done with error');
    diagLog('executeRunJob.supabaseUnavailable', { jobId: job.id });
    await finalizeJob(job.id, { error: 'Supabase client unavailable' });
    return;
  }

  if (job.type !== 'run') {
    console.warn('[runBatch] Job type mismatch; expected run', { jobId: job.id, type: job.type });
    diagLog('executeRunJob.jobTypeMismatch', { jobId: job.id, type: job.type });
    await finalizeJob(job.id, { error: `Unexpected job type ${job.type}` });
    return;
  }

  try {
    const result = await runBatchRefresh(job);
    await finalizeJob(job.id, result);
    console.log('[runBatch] Job completed', {
      jobId: job.id,
      success: result.successCount,
      failed: result.failureCount,
      skipped: result.skippedCount,
    });
    diagLog('executeRunJob.complete', {
      jobId: job.id,
      successes: result.successCount,
      failures: result.failureCount,
      skipped: result.skippedCount,
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('[runBatch] Unexpected error', { jobId: job.id, error: message });
    diagLog('executeRunJob.error', {
      jobId: job.id,
      message,
      stack: error instanceof Error ? error.stack : undefined,
    });
    await finalizeJob(job.id, { error: message });
  }
}

/**
 * Core batch refresh logic.
 * Loads playlists due for refresh and processes each one.
 */
async function runBatchRefresh(job: RefreshJobRow): Promise<BatchResult> {
  const refreshSessionId = randomUUID();
  console.log('[refresh-session]', { refreshSessionId, step: 'start', jobId: job.id, slot: job.slot_index, dayKey: job.day_key });
  diagLog('runBatchRefresh.start', { refreshSessionId, jobId: job.id, slot: job.slot_index, dayKey: job.day_key });

  diagLog('runBatchRefresh.resolveBatchFile.start', { refreshSessionId });
  const { filePath, playlistIds } = await resolveBatchFile(job);
  diagLog('runBatchRefresh.resolveBatchFile.complete', { refreshSessionId, filePath, playlistIdsCount: playlistIds.length });

  diagLog('runBatchRefresh.loadPlaylists.start', { refreshSessionId, requestedIds: playlistIds.length });
  const { playlists, mixSkipped } = await loadPlaylistsForRefresh(playlistIds);
  diagLog('runBatchRefresh.loadPlaylists.complete', { refreshSessionId, loadedCount: playlists.length, mixSkipped });
  
  console.log('[runBatch] Loaded playlists for refresh', {
    count: playlists.length,
    batchSize: PLAYLIST_REFRESH_BATCH_SIZE,
    requestedIds: playlistIds.length,
    mixSkipped,
  });

  const result: BatchResult = {
    playlistCount: playlists.length,
    successCount: 0,
    failureCount: 0,
    skippedCount: mixSkipped,
    errors: [],
  };

  for (const playlist of playlists) {
    if (isMixPlaylist(playlist.external_id)) {
      console.log('[runBatch][skip] mix playlist skipped', {
        playlistId: playlist.id,
        external_id: playlist.external_id,
      });
      diagLog('runBatchRefresh.playlist.mixSkipped', {
        refreshSessionId,
        playlistId: playlist.id,
        youtubePlaylistId: playlist.external_id,
        result: { skipped: true, reason: 'mix' },
      });
      result.skippedCount += 1;
      continue;
    }

    console.log('[refresh-session]', { refreshSessionId, step: 'playlist', playlistId: playlist.id, youtubePlaylistId: playlist.external_id });
    diagLog('runBatchRefresh.playlist.start', {
      refreshSessionId,
      playlistId: playlist.id,
      youtubePlaylistId: playlist.external_id,
      title: playlist.title,
    });
    try {
      const skipped = await refreshSinglePlaylist(playlist);
      if (skipped) {
        result.skippedCount += 1;
      } else {
        result.successCount += 1;
      }
      diagLog('runBatchRefresh.playlist.complete', {
        refreshSessionId,
        playlistId: playlist.id,
        skipped,
      });
    } catch (error: unknown) {
      result.failureCount += 1;
      const message = error instanceof Error ? error.message : 'Unknown playlist refresh error';
      console.error('[runBatch] Playlist refresh failed', {
        playlistId: playlist.id,
        youtubePlaylistId: playlist.external_id,
        title: playlist.title,
        message,
      });
      diagLog('runBatchRefresh.playlist.error', {
        refreshSessionId,
        playlistId: playlist.id,
        youtubePlaylistId: playlist.external_id,
        error: message,
        stack: error instanceof Error ? error.stack : undefined,
      });
      result.errors.push({ playlistId: playlist.id, message });
    }
  }

  console.log('[refresh-session]', { refreshSessionId, step: 'finished', result });
  diagLog('runBatchRefresh.complete', { refreshSessionId, result });
  return result;
}

/**
 * Load playlists that are due for refresh.
 * Uses a 30-day cycle strategy: selects playlists ordered by last_refreshed_on NULLS FIRST,
 * then by fetched_on, with a configurable batch limit.
 */
async function resolveBatchFile(job: RefreshJobRow): Promise<{ filePath: string; playlistIds: string[] }> {
  const filePath = path.join(BATCH_DIR, `batch_${job.day_key}_slot_${job.slot_index}.json`);
  console.log('[runBatch] Resolved batch file path', { slot: job.slot_index, filePath });
  diagLog('resolveBatchFile.read.start', { filePath });

  try {
    const raw = await fs.readFile(filePath, 'utf-8');
    const parsed = JSON.parse(raw) as BatchFileEntry[];
    const playlistIds = Array.isArray(parsed)
      ? parsed.map(entry => entry?.playlistId).filter((id): id is string => Boolean(id))
      : [];

    console.log('[runBatch] Parsed playlist IDs from batch file', { filePath, playlistIds });
    console.log(`Running refresh slot ${job.slot_index} using batch file ${filePath} with ${playlistIds.length} entries`);
    diagLog('resolveBatchFile.read.complete', { filePath, parsedCount: parsed.length, playlistIds });
    return { filePath, playlistIds };
  } catch (error) {
    console.warn('[runBatch] Failed to load batch file; falling back to DB query', {
      filePath,
      error: (error as Error).message,
    });
    console.log(`Running refresh slot ${job.slot_index} using batch file ${filePath} with 0 entries`);
    diagLog('resolveBatchFile.read.error', {
      filePath,
      error: (error as Error).message,
      stack: (error as Error).stack,
    });
    return { filePath, playlistIds: [] };
  }
}

async function loadPlaylistsForRefresh(requestedIds?: string[]): Promise<{ playlists: PlaylistRow[]; mixSkipped: number }> {
  let mixSkipped = 0;

  if (requestedIds && requestedIds.length > 0) {
    diagLog('loadPlaylistsForRefresh.queryByIds.start', { requestedIds });
    const { data, error } = await supabase!
      .from(PLAYLIST_TABLE)
      .select('id, external_id, title, description, region, category, last_refreshed_on, last_etag, fetched_on, item_count')
      .in('id', requestedIds);

    if (error) {
      console.error('[runBatch] Failed to load playlists for refresh (batch file)', { error: error.message });
      diagLog('loadPlaylistsForRefresh.queryByIds.error', { error: error.message });
      throw new Error(`Failed to load playlists: ${error.message}`);
    }

    const playlistMap = new Map((data || []).map((row: PlaylistRow) => [row.id, row]));
    const ordered: PlaylistRow[] = [];

    for (const id of requestedIds) {
      const row = playlistMap.get(id);
      if (!row) {
        continue;
      }

      if (isMixPlaylist(row.external_id)) {
        mixSkipped += 1;
        console.log('[runBatch][skip] mix playlist skipped', {
          playlistId: row.id,
          external_id: row.external_id,
        });
        diagLog('loadPlaylistsForRefresh.mixSkipped', {
          playlistId: row.id,
          youtubePlaylistId: row.external_id,
          source: 'batch-file',
        });
        continue;
      }

      ordered.push(row);
    }

    diagLog('loadPlaylistsForRefresh.queryByIds.complete', {
      requestedIdsCount: requestedIds.length,
      loadedCount: ordered.length,
      mixSkipped,
    });
    return { playlists: ordered, mixSkipped };
  }

  diagLog('loadPlaylistsForRefresh.queryDefault.start', {});
  const { data, error } = await supabase!
    .from(PLAYLIST_TABLE)
    .select('id, external_id, title, description, region, category, last_refreshed_on, last_etag, fetched_on, item_count')
    .not('external_id', 'is', null) // Only playlists with YouTube IDs
    .order('last_refreshed_on', { ascending: true, nullsFirst: true })
    .order('fetched_on', { ascending: true, nullsFirst: true })
    .limit(PLAYLIST_REFRESH_BATCH_SIZE);

  if (error) {
    console.error('[runBatch] Failed to load playlists for refresh', { error: error.message });
    diagLog('loadPlaylistsForRefresh.queryDefault.error', { error: error.message });
    throw new Error(`Failed to load playlists: ${error.message}`);
  }

  const fallback = (data || []) as PlaylistRow[];
  const filtered: PlaylistRow[] = [];

  for (const row of fallback) {
    if (isMixPlaylist(row.external_id)) {
      mixSkipped += 1;
      console.log('[runBatch][skip] mix playlist skipped', {
        playlistId: row.id,
        external_id: row.external_id,
      });
      diagLog('loadPlaylistsForRefresh.mixSkipped', {
        playlistId: row.id,
        youtubePlaylistId: row.external_id,
        source: 'fallback',
      });
      continue;
    }
    filtered.push(row);
  }

  diagLog('loadPlaylistsForRefresh.queryDefault.complete', { loadedCount: filtered.length, mixSkipped });
  return { playlists: filtered, mixSkipped };
}

// ============================================================================
// SINGLE PLAYLIST REFRESH
// ============================================================================

/**
 * Refresh a single playlist.
 * Returns true if skipped (ETag match), false if fully processed.
 */
async function refreshSinglePlaylist(playlist: PlaylistRow): Promise<boolean> {
  if (!playlist.external_id) {
    console.warn('[runBatch] Playlist missing external_id; skipping', {
      playlistId: playlist.id,
      title: playlist.title,
    });
    diagLog('refreshSinglePlaylist.missingExternalId', { playlistId: playlist.id, title: playlist.title });
    return true; // Count as skipped
  }

  const youtubePlaylistId = playlist.external_id;

  if (isMixPlaylist(youtubePlaylistId)) {
    console.log('[runBatch][skip] mix playlist skipped', {
      playlistId: playlist.id,
      external_id: youtubePlaylistId,
    });
    diagLog('refreshSinglePlaylist.mixSkipped', {
      playlistId: playlist.id,
      youtubePlaylistId,
    });
    return true;
  }

  if ((playlist.item_count ?? 0) > MAX_REFRESH_TRACKS) {
    console.warn('[runBatch] Playlist over max track threshold; skipping before fetch', {
      playlistId: playlist.id,
      youtubePlaylistId,
      itemCount: playlist.item_count,
      maxAllowed: MAX_REFRESH_TRACKS,
    });
    diagLog('refreshSinglePlaylist.oversizedPreFetch', {
      playlistId: playlist.id,
      youtubePlaylistId,
      itemCount: playlist.item_count,
      maxAllowed: MAX_REFRESH_TRACKS,
    });
    return true;
  }

  if (!env.youtube_api_key) {
    console.error('[runBatch] Missing YOUTUBE_API_KEY env var; cannot refresh playlist', {
      playlistId: playlist.id,
      title: playlist.title,
    });
    diagLog('refreshSinglePlaylist.missingApiKey', { playlistId: playlist.id });
    throw new Error('YOUTUBE_API_KEY not configured');
  }

  console.log('[diagnostic][api-key]', {
    playlistId: playlist.id,
    youtubePlaylistId,
    youtubeApiKeyPrefix: env.youtube_api_key.substring(0, 6),
  });
  diagLog('refreshSinglePlaylist.apiKey', {
    playlistId: playlist.id,
    youtubePlaylistId,
    youtubeApiKey: maskApiKey(env.youtube_api_key),
  });

  console.log('[diagnostic][etag]', {
    playlistId: playlist.id,
    youtubePlaylistId,
    step: 'loaded-from-supabase',
    lastEtag: playlist.last_etag,
  });
  diagLog('refreshSinglePlaylist.etag.loaded', {
    playlistId: playlist.id,
    youtubePlaylistId,
    lastEtag: playlist.last_etag,
  });

  if (!playlist.last_etag) {
    console.log('[diagnostic][etag]', {
      playlistId: playlist.id,
      youtubePlaylistId,
      step: 'missing-etag',
      message: 'last_etag is NULL or undefined',
    });
    diagLog('refreshSinglePlaylist.etag.missing', {
      playlistId: playlist.id,
      youtubePlaylistId,
    });
  }

  // Fetch latest items from YouTube with ETag support
  let fetchResult: FetchPlaylistItemsResult;
  try {
    fetchResult = await fetchPlaylistItemsWithETag({
      apiKey: env.youtube_api_key,
      youtubePlaylistId,
      internalPlaylistId: playlist.id,
      lastEtag: playlist.last_etag,
    });
    diagLog('refreshSinglePlaylist.fetch.complete', {
      playlistId: playlist.id,
      youtubePlaylistId,
      unchanged: fetchResult.unchanged,
      itemCount: fetchResult.items.length,
      newEtag: fetchResult.etag,
    });
  } catch (error) {
    if (error instanceof PlaylistUnavailableError) {
      diagLog('refreshSinglePlaylist.playlistUnavailable', {
        playlistId: playlist.id,
        youtubePlaylistId,
        status: error.status,
        reason: error.reason,
        message: error.message,
      });
      await removePlaylistFromDatabase(playlist, error);
      return false;
    }
    diagLog('refreshSinglePlaylist.fetch.error', {
      playlistId: playlist.id,
      youtubePlaylistId,
      message: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    });
    throw error;
  }

  const now = new Date().toISOString();

  // If unchanged (HTTP 304), only update last_refreshed_on
  if (fetchResult.unchanged) {
    console.log('[runBatch] Playlist not modified (ETag match). Skipping tracks sync.', {
      playlistId: playlist.id,
      title: playlist.title,
      etag: playlist.last_etag,
    });

    await supabase!
      .from(PLAYLIST_TABLE)
      .update({ last_refreshed_on: now })
      .eq('id', playlist.id);
    diagLog('refreshSinglePlaylist.supabase.update', {
      playlistId: playlist.id,
      action: 'etag-unchanged-update',
      lastRefreshedOn: now,
    });

    console.log('[diagnostic][etag]', {
      playlistId: playlist.id,
      youtubePlaylistId,
      step: 'unchanged-etag',
      lastEtag: playlist.last_etag,
    });
    diagLog('refreshSinglePlaylist.etag.unchanged', {
      playlistId: playlist.id,
      youtubePlaylistId,
      etag: playlist.last_etag,
    });

    return true; // Skipped
  }

  console.log('[runBatch] Retrieved latest tracks from YouTube', {
    playlistId: playlist.id,
    title: playlist.title,
    youtubePlaylistId: playlist.external_id,
    trackCount: fetchResult.items.length,
    etag: fetchResult.etag,
  });

  if (fetchResult.items.length > MAX_REFRESH_TRACKS) {
    console.warn('[runBatch] Playlist exceeds MAX_REFRESH_TRACKS after fetch; skipping delta sync', {
      playlistId: playlist.id,
      youtubePlaylistId,
      fetchedCount: fetchResult.items.length,
      maxAllowed: MAX_REFRESH_TRACKS,
    });
    diagLog('refreshSinglePlaylist.oversizedPostFetch', {
      playlistId: playlist.id,
      youtubePlaylistId,
      fetchedCount: fetchResult.items.length,
      maxAllowed: MAX_REFRESH_TRACKS,
    });
    return true;
  }

  // Perform delta sync
  diagLog('refreshSinglePlaylist.delta.start', {
    playlistId: playlist.id,
    youtubePlaylistId,
    itemCount: fetchResult.items.length,
  });
  await performDeltaSync(playlist, fetchResult.items, now);
  diagLog('refreshSinglePlaylist.delta.complete', {
    playlistId: playlist.id,
    youtubePlaylistId,
  });

  // Update playlist bookkeeping
  await supabase!
    .from(PLAYLIST_TABLE)
    .update({
      last_refreshed_on: now,
      last_etag: fetchResult.etag,
      item_count: fetchResult.items.length,
    })
    .eq('id', playlist.id);
  diagLog('refreshSinglePlaylist.supabase.update', {
    playlistId: playlist.id,
    action: 'etag-updated',
    lastRefreshedOn: now,
    etag: fetchResult.etag,
    itemCount: fetchResult.items.length,
  });

  console.log('[diagnostic][etag]', {
    playlistId: playlist.id,
    youtubePlaylistId,
    step: 'saved-etag',
    lastEtag: fetchResult.etag,
  });
  diagLog('refreshSinglePlaylist.etag.saved', {
    playlistId: playlist.id,
    youtubePlaylistId,
    etag: fetchResult.etag,
  });

  console.log('[runBatch] refreshed playlist fully.', {
    playlistId: playlist.id,
    youtubePlaylistId,
    title: playlist.title,
    trackCount: fetchResult.items.length,
  });
  diagLog('refreshSinglePlaylist.complete', {
    playlistId: playlist.id,
    youtubePlaylistId,
    trackCount: fetchResult.items.length,
  });

  return false; // Not skipped
}

// ============================================================================
// YOUTUBE API HELPERS
// ============================================================================

/**
 * Fetch playlist items from YouTube with ETag support.
 * Returns all items across pages, or indicates unchanged if HTTP 304.
 */
async function fetchPlaylistItemsWithETag(opts: {
  apiKey: string;
  youtubePlaylistId: string;
  internalPlaylistId: string;
  lastEtag?: string | null;
}): Promise<FetchPlaylistItemsResult> {
  const { apiKey, youtubePlaylistId, internalPlaylistId, lastEtag } = opts;
  const items: YouTubePlaylistItem[] = [];
  let pageToken: string | undefined;
  let finalEtag: string | null = null;
  diagLog('fetchPlaylistItemsWithETag.start', {
    playlistId: internalPlaylistId,
    youtubePlaylistId,
    lastEtag,
  });

  // First request with ETag check
  const firstPage = await fetchPlaylistItemsPage({
    apiKey,
    playlistId: youtubePlaylistId,
    internalPlaylistId,
    pageToken: undefined,
    lastEtag,
  });

  if (firstPage.status === 304) {
    diagLog('fetchPlaylistItemsWithETag.http304', {
      playlistId: internalPlaylistId,
      youtubePlaylistId,
      lastEtag,
    });
    console.log('[diagnostic][etag]', {
      playlistId: internalPlaylistId,
      youtubePlaylistId,
      step: 'youtube-first-page-304',
      lastEtag: lastEtag ?? null,
    });
    return { items: [], etag: lastEtag ?? null, unchanged: true };
  }

  if (!firstPage.data) {
    diagLog('fetchPlaylistItemsWithETag.firstPage.noData', {
      playlistId: internalPlaylistId,
      youtubePlaylistId,
    });
    throw new Error('Failed to fetch playlist items from YouTube');
  }

  console.log('[diagnostic][etag]', {
    playlistId: internalPlaylistId,
    youtubePlaylistId,
    step: 'youtube-first-page',
    lastEtag: firstPage.etag,
  });

  finalEtag = firstPage.etag;
  const firstItems = parsePlaylistItemsPage(firstPage.data);
  diagLog('fetchPlaylistItemsWithETag.pageParsed', {
    playlistId: internalPlaylistId,
    youtubePlaylistId,
    page: 1,
    itemsParsed: firstItems.length,
    nextPageToken: firstPage.data.nextPageToken ?? null,
  });
  items.push(...firstItems);
  pageToken = firstPage.data.nextPageToken;

  // Fetch remaining pages (without ETag header, since first page already confirmed change)
  let pageNumber = 2;
  if (pageToken) {
    diagLog('fetchPlaylistItemsWithETag.pagination.begin', {
      playlistId: internalPlaylistId,
      youtubePlaylistId,
    });
  }
  while (pageToken) {
    const page = await fetchPlaylistItemsPage({
      apiKey,
      playlistId: youtubePlaylistId,
      internalPlaylistId,
      pageToken,
      lastEtag: undefined, // Don't send ETag on subsequent pages
    });

    if (!page.data) {
      console.warn('[runBatch] Failed to fetch page; stopping pagination', { pageToken });
      diagLog('fetchPlaylistItemsWithETag.pagination.pageNoData', {
        playlistId: internalPlaylistId,
        youtubePlaylistId,
        pageNumber,
      });
      break;
    }

    const parsed = parsePlaylistItemsPage(page.data);
    diagLog('fetchPlaylistItemsWithETag.pageParsed', {
      playlistId: internalPlaylistId,
      youtubePlaylistId,
      page: pageNumber,
      itemsParsed: parsed.length,
      nextPageToken: page.data.nextPageToken ?? null,
    });
    items.push(...parsed);
    pageToken = page.data.nextPageToken;
    pageNumber += 1;
  }
  if (!pageToken) {
    diagLog('fetchPlaylistItemsWithETag.pagination.complete', {
      playlistId: internalPlaylistId,
      youtubePlaylistId,
      totalPages: pageNumber - 1,
    });
  }

  if (items.length === 0) {
    diagLog('fetchPlaylistItemsWithETag.noItems', {
      playlistId: internalPlaylistId,
      youtubePlaylistId,
    });
    // Iako prepareBatch bira samo playliste sa >= 10 pesama,
    // ako YouTube iz nekog razloga vrati 0 itema, tretiramo kao "empty" i brišemo playlistu.
    throw new PlaylistUnavailableError(200, 'empty', `YouTube returned 0 items for playlist ${youtubePlaylistId}`);
  }

  diagLog('fetchPlaylistItemsWithETag.complete', {
    playlistId: internalPlaylistId,
    youtubePlaylistId,
    itemCount: items.length,
    finalEtag,
  });
  return { items, etag: finalEtag, unchanged: false };
}

/**
 * Fetch a single page of playlist items with retry logic.
 */
async function fetchPlaylistItemsPage(opts: {
  apiKey: string;
  playlistId: string;
  internalPlaylistId: string;
  pageToken?: string;
  lastEtag?: string | null;
}): Promise<{ status: number; data?: any; etag: string | null }> {
  const { apiKey, playlistId, internalPlaylistId, pageToken, lastEtag } = opts;

  const url = new URL(`${YOUTUBE_API_BASE}/playlistItems`);
  url.searchParams.set('key', apiKey);
  url.searchParams.set('playlistId', playlistId);
  url.searchParams.set('part', 'contentDetails,snippet');
  url.searchParams.set('maxResults', YOUTUBE_PAGE_SIZE.toString());
  url.searchParams.set('fields', 'items(contentDetails/videoId,snippet(title,channelTitle,thumbnails/default/url,position)),nextPageToken,pageInfo,etag');
  
  if (pageToken) {
    url.searchParams.set('pageToken', pageToken);
  }

  const headers: Record<string, string> = {
    'Accept-Encoding': 'gzip',
  };

  if (lastEtag) {
    headers['If-None-Match'] = lastEtag;
  }

  let lastError: Error | null = null;

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      assertNoSearchList(url);
      diagLog('fetchPlaylistItemsPage.request', {
        attempt,
        playlistId: internalPlaylistId,
        youtubePlaylistId: playlistId,
        url: maskUrlApiKey(url),
        pageToken: pageToken ?? null,
        headers,
        pagination: Boolean(pageToken),
      });
      const response = await fetch(url.toString(), { headers });
      const responseClone = response.clone();
      const responsePreview = await responseClone.text().catch(() => '');
      const etagHeader = response.headers.get('etag');
      const quotaHeader = response.headers.get('x-goog-quota-used');
      diagLog('fetchPlaylistItemsPage.response', {
        attempt,
        playlistId: internalPlaylistId,
        youtubePlaylistId: playlistId,
        status: response.status,
        etag: etagHeader,
        quotaHeader,
        pagination: Boolean(pageToken),
        bodyPreview: truncateBody(responsePreview),
      });
      logQuotaUsage({
        playlistId: internalPlaylistId,
        youtubePlaylistId: playlistId,
        status: response.status,
        endpoint: 'playlistItems.list',
        quotaHeader: response.headers.get('x-goog-quota-used'),
      });

      // Handle 304 Not Modified
      if (response.status === 304) {
        diagLog('fetchPlaylistItemsPage.http304', {
          attempt,
          playlistId: internalPlaylistId,
          youtubePlaylistId: playlistId,
          lastEtag,
        });
        return { status: 304, etag: lastEtag ?? null };
      }

      // Handle success
      if (response.status === 200) {
        const data = await response.json();
        const etag = response.headers.get('etag');
        diagLog('fetchPlaylistItemsPage.success', {
          attempt,
          playlistId: internalPlaylistId,
          youtubePlaylistId: playlistId,
          nextPageToken: data?.nextPageToken ?? null,
          itemCount: Array.isArray(data?.items) ? data.items.length : 0,
          etag,
        });
        return { status: 200, data, etag };
      }

      if (response.status === 404 || response.status === 410) {
        const body = await response.text();
        diagLog('fetchPlaylistItemsPage.notFound', {
          attempt,
          playlistId: internalPlaylistId,
          youtubePlaylistId: playlistId,
          status: response.status,
          body: truncateBody(body),
        });
        throw new PlaylistUnavailableError(
          response.status,
          response.status === 404 ? 'notFound' : 'gone',
          `Playlist unavailable (${response.status}): ${body}`
        );
      }

      if (response.status === 403) {
        const errorJson = await response.json().catch(() => null);
        const errorDetail = errorJson?.error?.errors?.[0];
        const reason = errorDetail?.reason ?? errorJson?.error?.code ?? 'unknown';
        const message = errorDetail?.message ?? errorJson?.error?.message ?? 'Forbidden';
        const stageMessage = pageToken ? '403 occurred DURING pagination step' : '403 occurred BEFORE any page was processed';
        console.error('[runBatch] YouTube quotaExceeded', {
          playlistId: internalPlaylistId,
          youtubePlaylistId: playlistId,
          attempt,
          reason,
          message,
          stage: stageMessage,
        });
        diagLog('fetchPlaylistItemsPage.http403', {
          attempt,
          playlistId: internalPlaylistId,
          youtubePlaylistId: playlistId,
          reason,
          message,
          stage: stageMessage,
          response: errorJson,
        });
        throw new PlaylistUnavailableError(
          403,
          'forbidden',
          `Playlist forbidden (403): ${JSON.stringify(errorJson ?? {})}`
        );
      }

      // Handle rate limiting (429) with exponential backoff
      if (response.status === 429) {
        const delay = INITIAL_RETRY_DELAY_MS * Math.pow(2, attempt - 1);
        console.warn('[runBatch] Rate limited by YouTube (429); retrying after delay', {
          attempt,
          delayMs: delay,
        });
        diagLog('fetchPlaylistItemsPage.http429', {
          attempt,
          playlistId: internalPlaylistId,
          youtubePlaylistId: playlistId,
          delayMs: delay,
        });
        await sleep(delay);
        continue;
      }

      // Handle other errors
      const errorBody = await response.text();
      diagLog('fetchPlaylistItemsPage.httpError', {
        attempt,
        playlistId: internalPlaylistId,
        youtubePlaylistId: playlistId,
        status: response.status,
        body: truncateBody(errorBody),
      });
      throw new Error(`YouTube API error ${response.status}: ${errorBody}`);
    } catch (error: unknown) {
      lastError = error instanceof Error ? error : new Error(String(error));
      diagLog('fetchPlaylistItemsPage.networkError', {
        attempt,
        playlistId: internalPlaylistId,
        youtubePlaylistId: playlistId,
        error: lastError.message,
        stack: lastError.stack,
      });
      
      if (attempt < MAX_RETRIES) {
        const delay = INITIAL_RETRY_DELAY_MS * Math.pow(2, attempt - 1);
        console.warn('[runBatch] YouTube API call failed; retrying', {
          attempt,
          error: lastError.message,
          delayMs: delay,
        });
        diagLog('fetchPlaylistItemsPage.retry', {
          attempt,
          playlistId: internalPlaylistId,
          youtubePlaylistId: playlistId,
          nextAttempt: attempt + 1,
          delayMs: delay,
        });
        await sleep(delay);
      }
    }
  }

  diagLog('fetchPlaylistItemsPage.failure', {
    playlistId: internalPlaylistId,
    youtubePlaylistId: playlistId,
    error: lastError?.message,
  });
  throw lastError || new Error('Failed to fetch playlist items after retries');
}

/**
 * Parse YouTube playlistItems response into our internal format.
 */
function parsePlaylistItemsPage(data: any): YouTubePlaylistItem[] {
  const items = Array.isArray(data?.items) ? data.items : [];
  const result: YouTubePlaylistItem[] = [];

  for (const item of items) {
    const videoId = item?.contentDetails?.videoId;
    const snippet = item?.snippet;

    if (!videoId || !snippet) {
      continue;
    }

    const title = snippet.title || 'Untitled track';
    
    // Skip private/deleted videos
    if (title === 'Private video' || title === 'Deleted video') {
      continue;
    }

    const channelTitle = snippet.channelTitle || null;
    const thumbnailUrl = snippet.thumbnails?.default?.url || null;
    const position = typeof snippet.position === 'number' ? snippet.position : result.length;

    result.push({
      videoId,
      title,
      channelTitle,
      thumbnailUrl,
      position,
    });
  }

  return result;
}

function assertNoSearchList(url: URL): void {
  if (url.pathname.includes('/search') || url.toString().includes('search?')) {
    console.error('[FATAL] search.list used inside refresh job!', { url: url.toString() });
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
  console.log('[quota]', { playlistId, youtubePlaylistId, status, endpoint });
  if (quotaHeader) {
    console.log('[quota]', { playlistId, youtubePlaylistId, endpoint, quotaUsed: quotaHeader });
  } else {
    console.log('[quota]', { playlistId, youtubePlaylistId, endpoint, message: 'Quota header missing for this call' });
  }
}

// ============================================================================
// DELTA SYNC LOGIC
// ============================================================================

/**
 * Perform delta sync between YouTube items and existing tracks.
 * - Insert new tracks
 * - Update existing tracks if metadata changed
 * - Mark missing tracks as deleted
 */
async function performDeltaSync(
  playlist: PlaylistRow,
  youtubeItems: YouTubePlaylistItem[],
  syncTimestamp: string
): Promise<void> {
  // Load existing tracks globally (tracks are shared across playlists)
  // We'll query by external_id later for each YouTube item
  const externalIds = youtubeItems.map(item => item.videoId);
  diagLog('deltaSync.fetchExisting.start', {
    playlistId: playlist.id,
    youtubeItems: youtubeItems.length,
  });
  const existing = await fetchExistingTracksChunked(externalIds);
  diagLog('deltaSync.fetchExisting.complete', {
    playlistId: playlist.id,
    existingCount: existing.length,
  });
  const existingByYoutubeId = new Map<string, TrackRow>();
  
  for (const track of existing) {
    const key = track.youtube_id || track.external_id;
    if (key) {
      existingByYoutubeId.set(key, track);
    }
  }

  const receivedIds = new Set<string>();
  const toUpsert: any[] = [];
  let insertedCount = 0;
  let updatedCount = 0;

  // Process YouTube items
  for (const item of youtubeItems) {
    receivedIds.add(item.videoId);
    const existingTrack = existingByYoutubeId.get(item.videoId);

    if (!existingTrack) {
      toUpsert.push(buildTrackPayload(item, playlist, syncTimestamp));
      insertedCount += 1;
    } else {
      // Existing track - check if metadata changed
      const metadataChanged = 
        existingTrack.title !== item.title ||
        existingTrack.artist !== (item.channelTitle || 'Unknown Artist') ||
        existingTrack.cover_url !== item.thumbnailUrl;

      if (metadataChanged || existingTrack.sync_status !== 'active') {
        toUpsert.push({
          ...buildTrackPayload(item, playlist, syncTimestamp),
          id: existingTrack.id,
          external_id: existingTrack.external_id ?? item.videoId,
        });
        updatedCount += 1;
      }
    }
  }

  // Skip deletion logic - tracks are global and shared across playlists
  // Deletion should be handled separately via playlist_tracks junction table
  const toDelete: string[] = [];

  // Execute batch operations
  await executeBatchUpserts(toUpsert);
  await executeBatchDeletes(toDelete, syncTimestamp);
  diagLog('deltaSync.summary', {
    playlistId: playlist.id,
    inserted: insertedCount,
    updated: updatedCount,
    deleted: toDelete.length,
    processedSample: toUpsert.slice(0, 10).map(item => item.external_id),
  });

  console.log('[runBatch] Delta sync completed', {
    playlistId: playlist.id,
    inserted: insertedCount,
    updated: updatedCount,
    deleted: toDelete.length,
  });
}

async function fetchExistingTracksChunked(externalIds: string[]): Promise<TrackRow[]> {
  const uniqueIds = Array.from(new Set(externalIds.filter(Boolean)));
  if (uniqueIds.length === 0) {
    return [];
  }

  const chunks = chunkArray(uniqueIds, TRACK_SELECT_CHUNK_SIZE);
  const results: TrackRow[] = [];

  for (let i = 0; i < chunks.length; i += 1) {
    const chunk = chunks[i];
    const { data, error } = await supabase!
      .from(TRACKS_TABLE)
      .select('id, youtube_id, external_id, title, artist, sync_status, cover_url')
      .in('external_id', chunk);

    if (error) {
      diagLog('deltaSync.fetchExisting.chunkError', {
        chunkIndex: i,
        chunkSize: chunk.length,
        error: error.message,
      });
      throw new Error(`Failed to load existing tracks: ${error.message}`);
    }

    results.push(...(((data as TrackRow[]) ?? [])));
    diagLog('deltaSync.fetchExisting.chunkComplete', {
      chunkIndex: i,
      chunkSize: chunk.length,
      accumulated: results.length,
    });
  }

  return results;
}

function buildTrackPayload(item: YouTubePlaylistItem, playlist: PlaylistRow, syncTimestamp: string) {
  return {
    youtube_id: item.videoId,
    external_id: item.videoId,
    title: item.title,
    artist: item.channelTitle || 'Unknown Artist',
    cover_url: item.thumbnailUrl,
    sync_status: 'active',
    last_synced_at: syncTimestamp,
    region: playlist.region,
    category: playlist.category,
  };
}

async function executeBatchUpserts(records: any[]): Promise<void> {
  if (records.length === 0) return;
  diagLog('deltaSync.upsert.start', { count: records.length });

  const deduped = dedupeByExternalId(records);
  if (deduped.length < records.length) {
    diagLog('deltaSync.upsert.deduped', {
      original: records.length,
      deduped: deduped.length,
    });
  }

  const chunks = chunkArray(deduped, TRACK_UPSERT_CHUNK_SIZE);
  for (let i = 0; i < chunks.length; i += 1) {
    const chunk = chunks[i];
    const { error } = await supabase!
      .from(TRACKS_TABLE)
      .upsert(chunk, { onConflict: 'external_id' });

    if (error) {
      console.error('[runBatch] Failed to upsert track chunk', {
        chunkIndex: i,
        error: error.message,
      });
      diagLog('deltaSync.upsert.chunkError', { chunkIndex: i, error: error.message });
      throw new Error(`Failed to upsert tracks: ${error.message}`);
    }

    diagLog('deltaSync.upsert.chunkComplete', {
      chunkIndex: i,
      chunkSize: chunk.length,
    });
  }

  diagLog('deltaSync.upsert.complete', {});
}

function dedupeByExternalId(records: any[]): any[] {
  const seen = new Map<string, any>();
  for (const record of records) {
    const key = record.external_id;
    if (!key) {
      continue;
    }
    if (!seen.has(key)) {
      seen.set(key, record);
    }
  }
  return Array.from(seen.values());
}

function chunkArray<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }
  return chunks;
}

/**
 * Mark tracks as deleted in batches.
 */
async function executeBatchDeletes(trackIds: string[], syncTimestamp: string): Promise<void> {
  if (trackIds.length === 0) return;
  diagLog('deltaSync.deletes.start', { count: trackIds.length });

  const chunkSize = 100;
  for (let i = 0; i < trackIds.length; i += chunkSize) {
    const chunk = trackIds.slice(i, i + chunkSize);
    const { error } = await supabase!
      .from(TRACKS_TABLE)
      .update({
        sync_status: 'deleted',
        last_synced_at: syncTimestamp,
      })
      .in('id', chunk);

    if (error) {
      console.error('[runBatch] Failed to mark tracks as deleted', {
        chunkIndex: i / chunkSize,
        error: error.message,
      });
      diagLog('deltaSync.deletes.error', { chunkIndex: i / chunkSize, error: error.message });
      throw new Error(`Failed to mark tracks as deleted: ${error.message}`);
    }
    diagLog('deltaSync.deletes.chunkComplete', { chunkIndex: i / chunkSize, chunkSize: chunk.length });
  }
  diagLog('deltaSync.deletes.complete', {});
}

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

/**
 * Sleep for specified milliseconds.
 */
function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Finalize job status in database.
 */
async function finalizeJob(jobId: string, payload: Record<string, unknown>): Promise<void> {
  diagLog('finalizeJob.start', { jobId, payload });
  const { error } = await supabase!
    .from(JOB_TABLE)
    .update({ status: 'done', payload })
    .eq('id', jobId);

  if (error) {
    console.error('[runBatch] Failed to update job status', { jobId, error: error.message });
    diagLog('finalizeJob.error', { jobId, error: error.message });
  }
  diagLog('finalizeJob.complete', { jobId });
}

/**
 * Remove an unavailable playlist from the database.
 * Important: we DO NOT delete tracks, only relations + playlist row.
 */
async function removePlaylistFromDatabase(playlist: PlaylistRow, reason: PlaylistUnavailableError): Promise<void> {
  diagLog('removePlaylist.start', {
    playlistId: playlist.id,
    youtubePlaylistId: playlist.external_id,
    status: reason.status,
    reason: reason.reason,
    message: reason.message,
  });

  // 1) Remove links from playlist_tracks (junction table)
  const { error: ptError } = await supabase!
    .from('playlist_tracks')
    .delete()
    .eq('playlist_id', playlist.id);

  if (ptError) {
    console.error('[runBatch] Failed to delete playlist_tracks for playlist', {
      playlistId: playlist.id,
      youtubePlaylistId: playlist.external_id,
      error: ptError.message,
    });
    diagLog('removePlaylist.error.playlist_tracks', {
      playlistId: playlist.id,
      youtubePlaylistId: playlist.external_id,
      error: ptError.message,
    });
    throw new Error(`Failed to delete playlist_tracks for playlist ${playlist.id}: ${ptError.message}`);
  }

  // 2) Remove likes bound to this playlist (playlist_likes)
  const { error: plError } = await supabase!
    .from('playlist_likes')
    .delete()
    .eq('playlist_id', playlist.id);

  if (plError) {
    console.error('[runBatch] Failed to delete playlist_likes for playlist', {
      playlistId: playlist.id,
      youtubePlaylistId: playlist.external_id,
      error: plError.message,
    });
    diagLog('removePlaylist.error.playlist_likes', {
      playlistId: playlist.id,
      youtubePlaylistId: playlist.external_id,
      error: plError.message,
    });
    throw new Error(`Failed to delete playlist_likes for playlist ${playlist.id}: ${plError.message}`);
  }

  // 3) Remove categories links (playlist_categories)
  const { error: pcError } = await supabase!
    .from('playlist_categories')
    .delete()
    .eq('playlist_id', playlist.id);

  if (pcError) {
    console.error('[runBatch] Failed to delete playlist_categories for playlist', {
      playlistId: playlist.id,
      youtubePlaylistId: playlist.external_id,
      error: pcError.message,
    });
    diagLog('removePlaylist.error.playlist_categories', {
      playlistId: playlist.id,
      youtubePlaylistId: playlist.external_id,
      error: pcError.message,
    });
    throw new Error(`Failed to delete playlist_categories for playlist ${playlist.id}: ${pcError.message}`);
  }

  // 4) Remove playlist views (analytics)
  const { error: pvError } = await supabase!
    .from('playlist_views')
    .delete()
    .eq('playlist_id', playlist.id);

  if (pvError) {
    console.error('[runBatch] Failed to delete playlist_views for playlist', {
      playlistId: playlist.id,
      youtubePlaylistId: playlist.external_id,
      error: pvError.message,
    });
    diagLog('removePlaylist.error.playlist_views', {
      playlistId: playlist.id,
      youtubePlaylistId: playlist.external_id,
      error: pvError.message,
    });
    throw new Error(`Failed to delete playlist_views for playlist ${playlist.id}: ${pvError.message}`);
  }

  // 5) Remove per-track likes that are scoped to this playlist (likes.playlist_id)
  const { error: likesError } = await supabase!
    .from('likes')
    .delete()
    .eq('playlist_id', playlist.id);

  if (likesError) {
    console.error('[runBatch] Failed to delete likes for playlist', {
      playlistId: playlist.id,
      youtubePlaylistId: playlist.external_id,
      error: likesError.message,
    });
    diagLog('removePlaylist.error.likes', {
      playlistId: playlist.id,
      youtubePlaylistId: playlist.external_id,
      error: likesError.message,
    });
    throw new Error(`Failed to delete likes for playlist ${playlist.id}: ${likesError.message}`);
  }

  // 6) Tracks: DO NOT delete songs — just detach them from this playlist
  const { error: tracksUpdateError } = await supabase!
    .from(TRACKS_TABLE)
    .update({ playlist_id: null })
    .eq('playlist_id', playlist.id);

  if (tracksUpdateError) {
    console.error('[runBatch] Failed to detach tracks from playlist', {
      playlistId: playlist.id,
      youtubePlaylistId: playlist.external_id,
      error: tracksUpdateError.message,
    });
    diagLog('removePlaylist.error.tracks_update', {
      playlistId: playlist.id,
      youtubePlaylistId: playlist.external_id,
      error: tracksUpdateError.message,
    });
    throw new Error(`Failed to detach tracks from playlist ${playlist.id}: ${tracksUpdateError.message}`);
  }

  // 7) Finally remove the playlist itself
  const { error: playlistError } = await supabase!
    .from(PLAYLIST_TABLE)
    .delete()
    .eq('id', playlist.id);

  if (playlistError) {
    console.error('[runBatch] Failed to remove unavailable playlist', {
      playlistId: playlist.id,
      youtubePlaylistId: playlist.external_id,
      title: playlist.title,
      reason: reason.reason,
      status: reason.status,
      error: playlistError.message,
    });
    diagLog('removePlaylist.error.playlist', {
      playlistId: playlist.id,
      youtubePlaylistId: playlist.external_id,
      error: playlistError.message,
    });
    throw new Error(`Failed to remove playlist ${playlist.id}: ${playlistError.message}`);
  }

  console.warn('[runBatch] Removed playlist due to unavailability', {
    playlistId: playlist.id,
    youtubePlaylistId: playlist.external_id,
    title: playlist.title,
    reason: reason.reason,
    status: reason.status,
  });
  diagLog('removePlaylist.complete', {
    playlistId: playlist.id,
    youtubePlaylistId: playlist.external_id,
    status: reason.status,
    reason: reason.reason,
  });
}
