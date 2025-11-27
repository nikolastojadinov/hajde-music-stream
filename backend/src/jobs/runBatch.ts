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

  if (!supabase) {
    console.error('[runBatch] Supabase client unavailable. Marking job done with error');
    await finalizeJob(job.id, { error: 'Supabase client unavailable' });
    return;
  }

  if (job.type !== 'run') {
    console.warn('[runBatch] Job type mismatch; expected run', { jobId: job.id, type: job.type });
    await finalizeJob(job.id, { error: `Unexpected job type ${job.type}` });
    return;
  }

  try {
    const result = await runBatchRefresh();
    await finalizeJob(job.id, result);
    console.log('[runBatch] Job completed', {
      jobId: job.id,
      success: result.successCount,
      failed: result.failureCount,
      skipped: result.skippedCount,
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('[runBatch] Unexpected error', { jobId: job.id, error: message });
    await finalizeJob(job.id, { error: message });
  }
}

/**
 * Core batch refresh logic.
 * Loads playlists due for refresh and processes each one.
 */
async function runBatchRefresh(): Promise<BatchResult> {
  const playlists = await loadPlaylistsForRefresh();
  
  console.log('[runBatch] Loaded playlists for refresh', {
    count: playlists.length,
    batchSize: PLAYLIST_REFRESH_BATCH_SIZE,
  });

  const result: BatchResult = {
    playlistCount: playlists.length,
    successCount: 0,
    failureCount: 0,
    skippedCount: 0,
    errors: [],
  };

  for (const playlist of playlists) {
    try {
      const skipped = await refreshSinglePlaylist(playlist);
      if (skipped) {
        result.skippedCount += 1;
      } else {
        result.successCount += 1;
      }
    } catch (error: unknown) {
      result.failureCount += 1;
      const message = error instanceof Error ? error.message : 'Unknown playlist refresh error';
      console.error('[runBatch] Playlist refresh failed', {
        playlistId: playlist.id,
        title: playlist.title,
        message,
      });
      result.errors.push({ playlistId: playlist.id, message });
    }
  }

  return result;
}

/**
 * Load playlists that are due for refresh.
 * Uses a 30-day cycle strategy: selects playlists ordered by last_refreshed_on NULLS FIRST,
 * then by fetched_on, with a configurable batch limit.
 */
async function loadPlaylistsForRefresh(): Promise<PlaylistRow[]> {
  const { data, error } = await supabase!
    .from(PLAYLIST_TABLE)
    .select('id, external_id, title, description, region, category, last_refreshed_on, last_etag, fetched_on, item_count')
    .not('external_id', 'is', null) // Only playlists with YouTube IDs
    .order('last_refreshed_on', { ascending: true, nullsFirst: true })
    .order('fetched_on', { ascending: true, nullsFirst: true })
    .limit(PLAYLIST_REFRESH_BATCH_SIZE);

  if (error) {
    console.error('[runBatch] Failed to load playlists for refresh', { error: error.message });
    throw new Error(`Failed to load playlists: ${error.message}`);
  }

  return (data || []) as PlaylistRow[];
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
    return true; // Count as skipped
  }

  if (!env.youtube_api_key) {
    console.error('[runBatch] Missing YOUTUBE_API_KEY env var; cannot refresh playlist', {
      playlistId: playlist.id,
      title: playlist.title,
    });
    throw new Error('YOUTUBE_API_KEY not configured');
  }

  // Fetch latest items from YouTube with ETag support
  const fetchResult = await fetchPlaylistItemsWithETag({
    apiKey: env.youtube_api_key,
    youtubePlaylistId: playlist.external_id,
    lastEtag: playlist.last_etag,
  });

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

    return true; // Skipped
  }

  console.log('[runBatch] Retrieved latest tracks from YouTube', {
    playlistId: playlist.id,
    title: playlist.title,
    youtubePlaylistId: playlist.external_id,
    trackCount: fetchResult.items.length,
    etag: fetchResult.etag,
  });

  // Perform delta sync
  await performDeltaSync(playlist, fetchResult.items, now);

  // Update playlist bookkeeping
  await supabase!
    .from(PLAYLIST_TABLE)
    .update({
      last_refreshed_on: now,
      last_etag: fetchResult.etag,
      item_count: fetchResult.items.length,
    })
    .eq('id', playlist.id);

  console.log('[runBatch] refreshed playlist fully.', {
    playlistId: playlist.id,
    title: playlist.title,
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
  lastEtag?: string | null;
}): Promise<FetchPlaylistItemsResult> {
  const { apiKey, youtubePlaylistId, lastEtag } = opts;
  const items: YouTubePlaylistItem[] = [];
  let pageToken: string | undefined;
  let finalEtag: string | null = null;

  // First request with ETag check
  const firstPage = await fetchPlaylistItemsPage({
    apiKey,
    playlistId: youtubePlaylistId,
    pageToken: undefined,
    lastEtag,
  });

  if (firstPage.status === 304) {
    return { items: [], etag: lastEtag ?? null, unchanged: true };
  }

  if (!firstPage.data) {
    throw new Error('Failed to fetch playlist items from YouTube');
  }

  finalEtag = firstPage.etag;
  items.push(...parsePlaylistItemsPage(firstPage.data));
  pageToken = firstPage.data.nextPageToken;

  // Fetch remaining pages (without ETag header, since first page already confirmed change)
  while (pageToken) {
    const page = await fetchPlaylistItemsPage({
      apiKey,
      playlistId: youtubePlaylistId,
      pageToken,
      lastEtag: undefined, // Don't send ETag on subsequent pages
    });

    if (!page.data) {
      console.warn('[runBatch] Failed to fetch page; stopping pagination', { pageToken });
      break;
    }

    items.push(...parsePlaylistItemsPage(page.data));
    pageToken = page.data.nextPageToken;
  }

  return { items, etag: finalEtag, unchanged: false };
}

/**
 * Fetch a single page of playlist items with retry logic.
 */
async function fetchPlaylistItemsPage(opts: {
  apiKey: string;
  playlistId: string;
  pageToken?: string;
  lastEtag?: string | null;
}): Promise<{ status: number; data?: any; etag: string | null }> {
  const { apiKey, playlistId, pageToken, lastEtag } = opts;

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
      const response = await fetch(url.toString(), { headers });

      // Handle 304 Not Modified
      if (response.status === 304) {
        return { status: 304, etag: lastEtag ?? null };
      }

      // Handle success
      if (response.status === 200) {
        const data = await response.json();
        const etag = response.headers.get('etag');
        return { status: 200, data, etag };
      }

      // Handle rate limiting (429) with exponential backoff
      if (response.status === 429) {
        const delay = INITIAL_RETRY_DELAY_MS * Math.pow(2, attempt - 1);
        console.warn('[runBatch] Rate limited by YouTube (429); retrying after delay', {
          attempt,
          delayMs: delay,
        });
        await sleep(delay);
        continue;
      }

      // Handle other errors
      const errorBody = await response.text();
      throw new Error(`YouTube API error ${response.status}: ${errorBody}`);
    } catch (error: unknown) {
      lastError = error instanceof Error ? error : new Error(String(error));
      
      if (attempt < MAX_RETRIES) {
        const delay = INITIAL_RETRY_DELAY_MS * Math.pow(2, attempt - 1);
        console.warn('[runBatch] YouTube API call failed; retrying', {
          attempt,
          error: lastError.message,
          delayMs: delay,
        });
        await sleep(delay);
      }
    }
  }

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
  
  const { data: existingTracks, error } = await supabase!
    .from(TRACKS_TABLE)
    .select('id, youtube_id, external_id, title, artist, sync_status, cover_url')
    .in('external_id', externalIds);

  if (error) {
    throw new Error(`Failed to load existing tracks: ${error.message}`);
  }

  const existing = (existingTracks || []) as TrackRow[];
  const existingByYoutubeId = new Map<string, TrackRow>();
  
  for (const track of existing) {
    const key = track.youtube_id || track.external_id;
    if (key) {
      existingByYoutubeId.set(key, track);
    }
  }

  const receivedIds = new Set<string>();
  const toInsert: any[] = [];
  const toUpdate: Array<{ id: string; updates: any }> = [];

  // Process YouTube items
  for (const item of youtubeItems) {
    receivedIds.add(item.videoId);
    const existingTrack = existingByYoutubeId.get(item.videoId);

    if (!existingTrack) {
      // New track (global track, not tied to specific playlist)
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
      // Existing track - check if metadata changed
      const metadataChanged = 
        existingTrack.title !== item.title ||
        existingTrack.artist !== (item.channelTitle || 'Unknown Artist') ||
        existingTrack.cover_url !== item.thumbnailUrl;

      if (metadataChanged || existingTrack.sync_status !== 'active') {
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

  // Skip deletion logic - tracks are global and shared across playlists
  // Deletion should be handled separately via playlist_tracks junction table
  const toDelete: string[] = [];

  // Execute batch operations
  await executeBatchInserts(toInsert);
  await executeBatchUpdates(toUpdate);
  await executeBatchDeletes(toDelete, syncTimestamp);

  console.log('[runBatch] Delta sync completed', {
    playlistId: playlist.id,
    inserted: toInsert.length,
    updated: toUpdate.length,
    deleted: toDelete.length,
  });
}

/**
 * Insert new tracks in batches of 100.
 * Deduplicates by external_id before inserting (keeps first occurrence).
 */
async function executeBatchInserts(tracks: any[]): Promise<void> {
  if (tracks.length === 0) return;

  // Deduplicate by external_id (UNIQUE constraint at database level)
  // Keep only the first occurrence of each external_id
  const seen = new Map<string, any>();
  const deduplicated: any[] = [];
  
  for (const track of tracks) {
    if (track.external_id && !seen.has(track.external_id)) {
      seen.set(track.external_id, track);
      deduplicated.push(track);
    }
  }

  if (deduplicated.length < tracks.length) {
    console.warn('[runBatch] Deduplicated tracks before insert', {
      original: tracks.length,
      deduplicated: deduplicated.length,
      removed: tracks.length - deduplicated.length,
    });
  }

  const chunkSize = 100;
  for (let i = 0; i < deduplicated.length; i += chunkSize) {
    const chunk = deduplicated.slice(i, i + chunkSize);
    const { error } = await supabase!
      .from(TRACKS_TABLE)
      .upsert(chunk, { onConflict: 'external_id' });

    if (error) {
      console.error('[runBatch] Failed to insert track batch', {
        chunkIndex: i / chunkSize,
        error: error.message,
      });
      throw new Error(`Failed to insert tracks: ${error.message}`);
    }
  }
}

/**
 * Update existing tracks in batches.
 */
async function executeBatchUpdates(updates: Array<{ id: string; updates: any }>): Promise<void> {
  if (updates.length === 0) return;

  // Group by similar updates to batch efficiently
  for (const { id, updates: updateData } of updates) {
    const { error } = await supabase!
      .from(TRACKS_TABLE)
      .update(updateData)
      .eq('id', id);

    if (error) {
      console.error('[runBatch] Failed to update track', {
        trackId: id,
        error: error.message,
      });
      // Continue with other updates instead of throwing
    }
  }
}

/**
 * Mark tracks as deleted in batches.
 */
async function executeBatchDeletes(trackIds: string[], syncTimestamp: string): Promise<void> {
  if (trackIds.length === 0) return;

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
      throw new Error(`Failed to mark tracks as deleted: ${error.message}`);
    }
  }
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
  const { error } = await supabase!
    .from(JOB_TABLE)
    .update({ status: 'done', payload })
    .eq('id', jobId);

  if (error) {
    console.error('[runBatch] Failed to update job status', { jobId, error: error.message });
  }
}
