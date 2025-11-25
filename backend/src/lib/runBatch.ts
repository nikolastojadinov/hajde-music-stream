import path from 'path';
import { promises as fs } from 'fs';
import { DateTime } from 'luxon';
import supabase from '../services/supabaseClient';

const TIMEZONE = 'Europe/Budapest';
const BATCH_DIR = path.resolve(__dirname, '../../tmp/refresh_batches');
const JOB_TABLE = 'refresh_jobs';
const PLAYLIST_TABLE = 'playlists';
const TRACKS_TABLE = 'tracks';
const PLAYLIST_TRACKS_TABLE = 'playlist_tracks';

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
  console.warn('[runBatch] fetchLatestYouTubeTracks stub invoked', { playlistId, title });
  return [];
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
