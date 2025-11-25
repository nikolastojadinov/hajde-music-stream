import path from 'path';
import { promises as fs } from 'fs';
import { DateTime } from 'luxon';
import supabase from '../services/supabaseClient';

const TIMEZONE = 'Europe/Budapest';
const PLAYLIST_LIMIT = 200;
const BATCH_DIR = path.resolve(__dirname, '../../tmp/refresh_batches');
const PLAYLIST_TABLE = 'playlists';
const JOB_TABLE = 'refresh_jobs';

type JobStatus = 'pending' | 'running' | 'done' | 'error';
type JobType = 'prepare' | 'run';

type RefreshJobRow = {
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
  title: string | null;
  last_refreshed_on: string | null;
  track_count: number | null;
  sync_status?: string | null;
};

export async function executePrepareJob(job: RefreshJobRow): Promise<void> {
  const scheduledLocal = DateTime.fromISO(job.scheduled_at, { zone: 'utc' }).setZone(TIMEZONE);
  console.log('[PrepareBatch] Starting job', {
    jobId: job.id,
    type: job.type,
    scheduledAtBudapest: scheduledLocal.toISO(),
  });

  if (!supabase) {
    console.error('[PrepareBatch] Supabase client unavailable. Marking job done with error');
    await finalizeJob(job.id, { error: 'Supabase client unavailable' });
    return;
  }

  if (job.type !== 'prepare') {
    console.warn('[PrepareBatch] Job type mismatch; expected prepare', { jobId: job.id, type: job.type });
    await finalizeJob(job.id, { error: `Unexpected job type ${job.type}` });
    return;
  }

  try {
    await fs.mkdir(BATCH_DIR, { recursive: true });

    const playlists = await fetchEligiblePlaylists();
    if (playlists.length < PLAYLIST_LIMIT) {
      console.warn('[PrepareBatch] Fewer than 200 playlists available', { count: playlists.length });
    }

    const batchPayload = playlists.map((playlist) => ({
      playlistId: playlist.id,
      title: playlist.title ?? '',
      lastRefreshedOn: playlist.last_refreshed_on,
      trackCount: playlist.track_count ?? 0,
    }));

    const fileName = `batch_${job.day_key}_slot_${job.slot_index}.json`;
    const filePath = path.join(BATCH_DIR, fileName);

    await fs.writeFile(filePath, JSON.stringify(batchPayload, null, 2), 'utf-8');
    console.log('[PrepareBatch] Batch file written', { filePath });

    await finalizeJob(job.id, { file: filePath, entries: batchPayload });
  } catch (error) {
    console.error('[PrepareBatch] Error while executing prepare job', error);
    await finalizeJob(job.id, { error: (error as Error).message || 'Unknown error' });
  }
}

async function fetchEligiblePlaylists(): Promise<PlaylistRow[]> {
  const query = supabase!
    .from(PLAYLIST_TABLE)
    .select('id,title,last_refreshed_on,track_count,sync_status')
    .gte('track_count', 10)
    .neq('sync_status', 'deleted')
    .neq('sync_status', 'empty')
    .order('last_refreshed_on', { ascending: true, nullsFirst: true })
    .order('random')
    .limit(PLAYLIST_LIMIT);

  const { data, error } = await query;
  if (error) {
    throw error;
  }

  return (data as PlaylistRow[] | null) ?? [];
}

async function finalizeJob(jobId: string, payload: Record<string, unknown>): Promise<void> {
  const { error } = await supabase!
    .from(JOB_TABLE)
    .update({ status: 'done', payload })
    .eq('id', jobId);

  if (error) {
    console.error('[PrepareBatch] Failed to update job status', { jobId, error });
  }
}
