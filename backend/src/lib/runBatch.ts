import path from 'path';
import { promises as fs } from 'fs';
import axios from 'axios';
import { DateTime } from 'luxon';
import env from '../environments';
import supabase from '../services/supabaseClient';

const TIMEZONE = 'Europe/Budapest';
const BATCH_DIR = path.resolve(__dirname, '../../tmp/refresh_batches');
const JOB_TABLE = 'refresh_jobs';
const PLAYLIST_TABLE = 'playlists';
const TRACKS_TABLE = 'tracks';
const PLAYLIST_TRACKS_TABLE = 'playlist_tracks';
const YOUTUBE_API_BASE_URL = 'https://www.googleapis.com/youtube/v3';
const YOUTUBE_PAGE_SIZE = 50;

const DEFAULT_ARTIST = 'Unknown Artist';
const DEFAULT_TITLE = 'Untitled track';

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

type PlaylistBatchEntry = {
  playlistId: string;
  title?: string;
  lastRefreshedOn?: string | null;
  trackCount?: number;
};

type YouTubeTrack = {
  externalId?: string;
  youtubeId?: string;
  title?: string;
  artist?: string;
  durationSeconds?: number;
  coverUrl?: string;
  thumbnails?: string[];
  position?: number;
};

type NormalizedTrack = {
  externalId: string;
  youtubeId: string;
  title: string;
  artist: string;
  durationSeconds: number | null;
  coverUrl: string | null;
  position: number;
};

type PlaylistTrackRow = {
  trackId: string;
  externalId: string;
  youtubeId?: string | null;
  title?: string | null;
  artist?: string | null;
  duration?: number | null;
  coverUrl?: string | null;
  position: number;
};

type PlaylistTrackQueryRow = {
  track_id: string;
  position: number;
  tracks?: {
    id: string;
    external_id: string | null;
    youtube_id: string | null;
    title: string | null;
    artist: string | null;
    duration: number | null;
    cover_url: string | null;
  } | null;
};

type BatchResult = {
  file: string;
  playlistCount: number;
  successCount: number;
  failureCount: number;
  errors: Array<{ playlistId: string; message: string }>;
};

export async function executeRunJob(job: RefreshJobRow): Promise<void> {
  const scheduledLocal = DateTime.fromISO(job.scheduled_at, { zone: 'utc' }).setZone(TIMEZONE);
  console.log('[runBatch] Starting job', {
    jobId: job.id,
    type: job.type,
    scheduledAtBudapest: scheduledLocal.toISO(),
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
    const { entries: batchEntries, filePath: batchFilePath, source } = await loadBatchEntries(job);
    const result: BatchResult = {
      file: batchFilePath,
      playlistCount: batchEntries.length,
      successCount: 0,
      failureCount: 0,
      errors: [],
    };

    if (source === 'payload') {
      console.log('[runBatch] Loaded batch entries from Supabase payload fallback', {
        jobId: job.id,
        slot: job.slot_index,
        day: job.day_key,
      });
    }

    for (const entry of batchEntries) {
      if (!entry?.playlistId) {
        result.failureCount += 1;
        result.errors.push({ playlistId: 'unknown', message: 'Missing playlistId in batch entry' });
        continue;
      }

      try {
        await refreshSinglePlaylist(entry.playlistId, entry.title ?? undefined);
        result.successCount += 1;
      } catch (playlistError) {
        result.failureCount += 1;
        const message = (playlistError as Error).message || 'Unknown playlist refresh error';
        console.error('[runBatch] Playlist refresh failed', {
          playlistId: entry.playlistId,
          message,
        });
        result.errors.push({ playlistId: entry.playlistId, message });
      }
    }

    await finalizeJob(job.id, result);
  } catch (error: any) {
    console.error('[runBatch] Unexpected error', error);
    await finalizeJob(job.id, { error: error?.message || 'Unknown error' });
  }
}

type BatchLoadResult = {
  entries: PlaylistBatchEntry[];
  filePath: string;
  source: 'file' | 'payload';
};

async function loadBatchEntries(job: RefreshJobRow): Promise<BatchLoadResult> {
  const batchFilePath = path.join(BATCH_DIR, `batch_${job.day_key}_slot_${job.slot_index}.json`);

  try {
    const entries = await readBatchFile(batchFilePath);
    return { entries, filePath: batchFilePath, source: 'file' };
  } catch (error) {
    const nodeError = error as NodeJS.ErrnoException;
    if (nodeError.code !== 'ENOENT') {
      throw error;
    }

    console.warn('[runBatch] Batch file missing on disk, attempting Supabase payload fallback', {
      jobId: job.id,
      slot: job.slot_index,
      day: job.day_key,
    });

    const payloadEntries = await fetchPreparePayload(job);
    if (payloadEntries && payloadEntries.length > 0) {
      return { entries: payloadEntries, filePath: batchFilePath, source: 'payload' };
    }

    throw new Error('Batch file missing and no payload entries available');
  }
}

async function fetchPreparePayload(job: RefreshJobRow): Promise<PlaylistBatchEntry[] | null> {
  const { data, error } = await supabase!
    .from(JOB_TABLE)
    .select('payload')
    .eq('slot_index', job.slot_index)
    .eq('day_key', job.day_key)
    .eq('type', 'prepare')
    .order('scheduled_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    console.error('[runBatch] Failed to fetch prepare job payload', error);
    return null;
  }

  const payload = data?.payload as { entries?: PlaylistBatchEntry[] } | null;
  if (payload && Array.isArray(payload.entries)) {
    return payload.entries;
  }

  return null;
}

async function refreshSinglePlaylist(playlistId: string, title?: string): Promise<void> {
  const sourceTracks = await fetchLatestYouTubeTracks(playlistId, title);
  const normalizedTracks = normalizeSourceTracks(sourceTracks);

  if (normalizedTracks.length === 0) {
    console.warn('[runBatch] No tracks returned from source; skipping refresh', { playlistId, title });
    return;
  }

  const existingTracks = await loadExistingPlaylistTracks(playlistId);

  const newIds = new Set(normalizedTracks.map(track => track.externalId));
  const oldIds = new Set(existingTracks.map(track => track.externalId));

  const missingIds = Array.from(oldIds).filter(id => !newIds.has(id));
  const addedIds = Array.from(newIds).filter(id => !oldIds.has(id));
  const existingIds = Array.from(newIds).filter(id => oldIds.has(id));

  for (const missingId of missingIds) {
    const trackRow = existingTracks.find(track => track.externalId === missingId);
    if (!trackRow) continue;

    try {
      await markTrackAsDeleted(playlistId, trackRow.trackId);
    } catch (deleteError) {
      console.error('[runBatch] Failed to remove missing track', {
        playlistId,
        trackId: trackRow.trackId,
        error: (deleteError as Error).message,
      });
    }
  }

  for (const addedId of addedIds) {
    const track = normalizedTracks.find(item => item.externalId === addedId);
    if (!track) continue;

    try {
      await ensureTrackPresent(playlistId, track);
    } catch (addError) {
      console.error('[runBatch] Failed to insert new track', {
        playlistId,
        externalId: track.externalId,
        error: (addError as Error).message,
      });
    }
  }

  for (const existingId of existingIds) {
    const track = normalizedTracks.find(item => item.externalId === existingId);
    const existing = existingTracks.find(item => item.externalId === existingId);
    if (!track || !existing) continue;

    try {
      await updateExistingTrack(existing.trackId, track, playlistId, existing.position !== track.position);
    } catch (updateError) {
      console.error('[runBatch] Failed to update existing track', {
        playlistId,
        trackId: existing.trackId,
        error: (updateError as Error).message,
      });
    }
  }

  await updatePlaylistMetadata(playlistId, normalizedTracks.length);
  console.log(`[runBatch] refreshed playlist ${playlistId} fully.`, {
    playlistId,
    title,
    trackCount: normalizedTracks.length,
  });
}

async function readBatchFile(filePath: string): Promise<PlaylistBatchEntry[]> {
  const raw = await fs.readFile(filePath, 'utf-8');
  const parsed = JSON.parse(raw);

  if (!Array.isArray(parsed)) {
    throw new Error('Batch payload is not an array');
  }

  return parsed as PlaylistBatchEntry[];
}

async function loadExistingPlaylistTracks(playlistId: string): Promise<PlaylistTrackRow[]> {
  const { data, error } = await supabase!
    .from(PLAYLIST_TRACKS_TABLE)
    .select(
      `track_id, position,
       tracks (id, external_id, youtube_id, title, artist, duration, cover_url)`
    )
    .eq('playlist_id', playlistId);

  if (error) {
    throw error;
  }

  const rows = ((data ?? []) as unknown) as PlaylistTrackQueryRow[];

  return rows.map(row => {
    const track = row.tracks ?? null;
    const externalId = track?.external_id ?? track?.youtube_id ?? row.track_id;

    return {
      trackId: row.track_id,
      externalId,
      youtubeId: track?.youtube_id ?? null,
      title: track?.title ?? null,
      artist: track?.artist ?? null,
      duration: track?.duration ?? null,
      coverUrl: track?.cover_url ?? null,
      position: row.position,
    };
  });
}

function normalizeSourceTracks(tracks: YouTubeTrack[]): NormalizedTrack[] {
  return tracks
    .map((track, index) => {
      const externalId = track.externalId || track.youtubeId;
      const youtubeId = track.youtubeId || track.externalId;

      if (!externalId || !youtubeId) {
        return null;
      }

      return {
        externalId,
        youtubeId,
        title: track.title || DEFAULT_TITLE,
        artist: track.artist || DEFAULT_ARTIST,
        durationSeconds:
          typeof track.durationSeconds === 'number' ? track.durationSeconds : null,
        coverUrl: track.coverUrl || track.thumbnails?.[0] || null,
        position: Number.isFinite(track.position) ? Number(track.position) : index + 1,
      };
    })
    .filter((track): track is NormalizedTrack => Boolean(track));
}

async function markTrackAsDeleted(playlistId: string, trackId: string): Promise<void> {
  const timestamp = new Date().toISOString();

  const { error: trackError } = await supabase!
    .from(TRACKS_TABLE)
    .update({ sync_status: 'deleted', last_synced_at: timestamp })
    .eq('id', trackId);

  if (trackError) {
    throw trackError;
  }

  const { error: linkError } = await supabase!
    .from(PLAYLIST_TRACKS_TABLE)
    .delete()
    .match({ playlist_id: playlistId, track_id: trackId });

  if (linkError) {
    throw linkError;
  }
}

async function ensureTrackPresent(playlistId: string, track: NormalizedTrack): Promise<void> {
  const timestamp = new Date().toISOString();

  const existing = await supabase!
    .from(TRACKS_TABLE)
    .select('id')
    .eq('external_id', track.externalId)
    .maybeSingle();

  if (existing.error) {
    throw existing.error;
  }

  let trackId = existing.data?.id;

  if (!trackId) {
    const insertPayload = {
      title: track.title,
      artist: track.artist,
      duration: track.durationSeconds,
      youtube_id: track.youtubeId,
      external_id: track.externalId,
      cover_url: track.coverUrl,
      playlist_id: playlistId,
      sync_status: 'active',
      last_synced_at: timestamp,
    };

    const insertResult = await supabase!
      .from(TRACKS_TABLE)
      .insert(insertPayload)
      .select('id')
      .single();

    if (insertResult.error) {
      throw insertResult.error;
    }

    trackId = insertResult.data.id;
  } else {
    const updatePayload = {
      title: track.title,
      artist: track.artist,
      duration: track.durationSeconds,
      youtube_id: track.youtubeId,
      cover_url: track.coverUrl,
      sync_status: 'active',
      last_synced_at: timestamp,
    };

    const { error: updateError } = await supabase!
      .from(TRACKS_TABLE)
      .update(updatePayload)
      .eq('id', trackId);

    if (updateError) {
      throw updateError;
    }
  }

  await upsertPlaylistTrack(playlistId, trackId, track.position);
}

async function updateExistingTrack(
  trackDbId: string,
  track: NormalizedTrack,
  playlistId: string,
  shouldUpdatePosition: boolean
): Promise<void> {
  const timestamp = new Date().toISOString();

  const { error: updateError } = await supabase!
    .from(TRACKS_TABLE)
    .update({
      title: track.title,
      artist: track.artist,
      duration: track.durationSeconds,
      youtube_id: track.youtubeId,
      cover_url: track.coverUrl,
      sync_status: 'active',
      last_synced_at: timestamp,
    })
    .eq('id', trackDbId);

  if (updateError) {
    throw updateError;
  }

  if (shouldUpdatePosition) {
    const { error: positionError } = await supabase!
      .from(PLAYLIST_TRACKS_TABLE)
      .update({ position: track.position })
      .match({ playlist_id: playlistId, track_id: trackDbId });

    if (positionError) {
      throw positionError;
    }
  }
}

async function upsertPlaylistTrack(playlistId: string, trackId: string, position: number): Promise<void> {
  const insertPayload = { playlist_id: playlistId, track_id: trackId, position };

  const { error } = await supabase!
    .from(PLAYLIST_TRACKS_TABLE)
    .upsert(insertPayload, { onConflict: 'playlist_id,track_id' });

  if (error) {
    if (error.code === '23505') {
      const { error: updateError } = await supabase!
        .from(PLAYLIST_TRACKS_TABLE)
        .update({ position })
        .match({ playlist_id: playlistId, track_id: trackId });

      if (updateError) {
        throw updateError;
      }
    } else {
      throw error;
    }
  }
}

async function updatePlaylistMetadata(playlistId: string, trackCount: number): Promise<void> {
  const payload = {
    last_refreshed_on: new Date().toISOString(),
    track_count: trackCount,
  };

  const { error } = await supabase!
    .from(PLAYLIST_TABLE)
    .update(payload)
    .eq('id', playlistId);

  if (error) {
    console.error('[runBatch] Failed to update playlist metadata', { playlistId, error: error.message });
  }
}

async function fetchLatestYouTubeTracks(playlistId: string, title?: string): Promise<YouTubeTrack[]> {
  if (!env.youtube_api_key) {
    console.error('[runBatch] Missing YOUTUBE_API_KEY env var; cannot refresh playlist', {
      playlistId,
      title,
    });
    return [];
  }

  try {
    const playlistRow = await loadPlaylistSourceRow(playlistId);
    if (!playlistRow) {
      console.warn('[runBatch] Playlist not found before YouTube refresh', { playlistId, title });
      return [];
    }

    const youtubePlaylistId = resolveYoutubePlaylistId(playlistRow);
    if (!youtubePlaylistId) {
      console.warn('[runBatch] Unable to resolve YouTube playlist ID for refresh', {
        playlistId,
        title,
      });
      return [];
    }

    const tracks = await pullYouTubePlaylistTracks(youtubePlaylistId);
    console.log('[runBatch] Retrieved latest tracks from YouTube', {
      playlistId,
      title,
      youtubePlaylistId,
      trackCount: tracks.length,
    });
    return tracks;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error('[runBatch] Failed to fetch playlist from YouTube', {
      playlistId,
      title,
      error: message,
    });
    return [];
  }
}

async function loadPlaylistSourceRow(playlistId: string): Promise<Record<string, any> | null> {
  const { data, error } = await supabase!
    .from(PLAYLIST_TABLE)
    .select('*')
    .eq('id', playlistId)
    .maybeSingle();

  if (error) {
    throw error;
  }

  return (data as Record<string, any> | null) ?? null;
}

function resolveYoutubePlaylistId(row: Record<string, any>): string | null {
  const candidateFields = [
    row.external_id,
    row.youtube_playlist_id,
    row.source_playlist_id,
    row.youtube_id,
    row.source_id,
  ];

  for (const candidate of candidateFields) {
    const normalized = typeof candidate === 'string' ? candidate.trim() : '';
    if (normalized) {
      return normalized;
    }
  }

  const urlFields = [row.source_url, row.external_url, row.playlist_url, row.youtube_url];
  for (const url of urlFields) {
    const extracted = extractPlaylistIdFromString(url);
    if (extracted) {
      return extracted;
    }
  }

  return null;
}

function extractPlaylistIdFromString(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }

  if (/^(PL|UU|LL|FL|RD)[\w-]{10,}$/.test(trimmed)) {
    return trimmed;
  }

  try {
    const parsed = new URL(trimmed);
    const listParam = parsed.searchParams.get('list');
    if (listParam) {
      return listParam;
    }

    const segments = parsed.pathname.split('/').filter(Boolean);
    const playlistIndex = segments.findIndex(segment => segment === 'playlist');
    if (playlistIndex >= 0 && segments[playlistIndex + 1]) {
      return segments[playlistIndex + 1];
    }
  } catch (_) {
    // Not a URL; ignore
  }

  return null;
}

async function pullYouTubePlaylistTracks(youtubePlaylistId: string): Promise<YouTubeTrack[]> {
  const tracks: YouTubeTrack[] = [];
  let pageToken: string | undefined;

  do {
    const { data } = await axios.get(`${YOUTUBE_API_BASE_URL}/playlistItems`, {
      params: {
        key: env.youtube_api_key,
        playlistId: youtubePlaylistId,
        part: 'snippet,contentDetails',
        maxResults: YOUTUBE_PAGE_SIZE,
        pageToken,
      },
    });

    const items = Array.isArray(data?.items) ? data.items : [];
    const videoIds = items
      .map((item: any) => item?.contentDetails?.videoId || item?.snippet?.resourceId?.videoId)
      .filter((id: string | undefined): id is string => Boolean(id));

    const durationMap = await fetchVideoDurations(videoIds);

    for (const item of items) {
      const snippet = item?.snippet;
      const contentDetails = item?.contentDetails;
      const videoId: string | undefined =
        contentDetails?.videoId || snippet?.resourceId?.videoId || undefined;

      if (!snippet || !videoId) {
        continue;
      }

      const title = snippet.title ?? DEFAULT_TITLE;
      if (title === 'Private video' || title === 'Deleted video') {
        continue;
      }

      const artist = snippet.videoOwnerChannelTitle ?? snippet.channelTitle ?? DEFAULT_ARTIST;
      const thumbnails = collectThumbnailUrls(snippet.thumbnails);
      const durationSeconds = durationMap.get(videoId);
      const position =
        typeof snippet.position === 'number' ? snippet.position + 1 : tracks.length + 1;

      tracks.push({
        externalId: videoId,
        youtubeId: videoId,
        title,
        artist,
        durationSeconds,
        coverUrl: thumbnails[0] ?? null,
        thumbnails,
        position,
      });
    }

    pageToken = data?.nextPageToken;
  } while (pageToken);

  return tracks;
}

async function fetchVideoDurations(videoIds: string[]): Promise<Map<string, number | undefined>> {
  const map = new Map<string, number | undefined>();
  if (videoIds.length === 0) {
    return map;
  }

  for (const chunk of chunkArray(videoIds, 50)) {
    const { data } = await axios.get(`${YOUTUBE_API_BASE_URL}/videos`, {
      params: {
        key: env.youtube_api_key,
        id: chunk.join(','),
        part: 'contentDetails',
        maxResults: chunk.length,
      },
    });

    const items = Array.isArray(data?.items) ? data.items : [];
    for (const item of items) {
      const videoId: string | undefined = item?.id;
      const durationRaw: string | undefined = item?.contentDetails?.duration;
      if (!videoId) {
        continue;
      }
      map.set(videoId, parseYouTubeDuration(durationRaw));
    }
  }

  return map;
}

function chunkArray<T>(values: T[], chunkSize: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < values.length; i += chunkSize) {
    chunks.push(values.slice(i, i + chunkSize));
  }
  return chunks;
}

function parseYouTubeDuration(duration?: string): number | undefined {
  if (!duration) {
    return undefined;
  }

  const match = duration.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
  if (!match) {
    return undefined;
  }

  const hours = parseInt(match[1] ?? '0', 10);
  const minutes = parseInt(match[2] ?? '0', 10);
  const seconds = parseInt(match[3] ?? '0', 10);

  return hours * 3600 + minutes * 60 + seconds;
}

function collectThumbnailUrls(thumbnails?: Record<string, { url?: string }>): string[] {
  if (!thumbnails) {
    return [];
  }

  const priorityOrder = ['maxres', 'standard', 'high', 'medium', 'default'];
  const urls: string[] = [];
  const seen = new Set<string>();

  for (const key of priorityOrder) {
    const candidate = thumbnails[key]?.url;
    if (candidate && !seen.has(candidate)) {
      seen.add(candidate);
      urls.push(candidate);
    }
  }

  for (const value of Object.values(thumbnails)) {
    if (value?.url && !seen.has(value.url)) {
      seen.add(value.url);
      urls.push(value.url);
    }
  }

  return urls;
}

async function finalizeJob(jobId: string, payload: Record<string, unknown>): Promise<void> {
  const { error } = await supabase!
    .from(JOB_TABLE)
    .update({ status: 'done', payload })
    .eq('id', jobId);

  if (error) {
    console.error('[runBatch] Failed to update job status', { jobId, error });
  }
}
