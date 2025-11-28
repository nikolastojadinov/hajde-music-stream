import path from 'path';
import { promises as fs } from 'fs';
import { DateTime } from 'luxon';
import supabase from '../services/supabaseClient';

const TIMEZONE = 'Europe/Budapest';
const PLAYLIST_LIMIT = 200;
const BATCH_DIR = path.resolve(__dirname, '../../tmp/refresh_batches');
const PLAYLIST_TABLE = 'playlists';
const JOB_TABLE = 'refresh_jobs';
const MIX_PREFIX = 'RD';

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
  external_id?: string | null;
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
  const baseEligibility = await supabase!
    .from(PLAYLIST_TABLE)
    .select('id', { count: 'exact', head: true })
    .gte('track_count', 10)
    .eq('sync_status', 'active');

  if (baseEligibility.error) {
    throw baseEligibility.error;
  }

  const eligibleBeforeMixFilter = baseEligibility.count ?? 0;

  const filteredQuery = supabase!
    .from(PLAYLIST_TABLE)
    .select('id,title,last_refreshed_on,track_count,sync_status,external_id', { count: 'exact' })
    .gte('track_count', 10)
    .eq('sync_status', 'active')
    .not('external_id', 'ilike', `${MIX_PREFIX}%`)
    .order('last_refreshed_on', { ascending: true, nullsFirst: true })
    .order('random')
    .limit(PLAYLIST_LIMIT);

  const { data, error, count } = await filteredQuery;

  if (error) {
    throw error;
  }

  const playlists = (data as PlaylistRow[] | null) ?? [];
  const totalEligible = count ?? playlists.length;
  const mixExcluded = Math.max(eligibleBeforeMixFilter - totalEligible, 0);

  console.log('[prepare][exclude] skipped mix playlist', { mixExcluded });
  console.log('[diagnostic][prepare]', { totalEligible, selected: playlists.length });

  if (playlists.length < PLAYLIST_LIMIT) {
    const reason = totalEligible < PLAYLIST_LIMIT ? 'too_few_eligible' : 'insufficient_random_selection';
    console.warn('[diagnostic][prepare]', {
      message: 'Selected fewer playlists than requested',
      totalEligible,
      selected: playlists.length,
      reason,
    });
  }

  return playlists;
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

