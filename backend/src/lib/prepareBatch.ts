import path from 'path';
import { promises as fs } from 'fs';
import { DateTime } from 'luxon';
import supabase from '../services/supabaseClient';

const TIMEZONE = 'Europe/Budapest';
const PLAYLIST_LIMIT = 200;
const PRESELECT_LIMIT = 2000; // first stage
const BATCH_DIR = path.resolve(__dirname, '../../tmp/refresh_batches');
const JOB_TABLE = 'refresh_jobs';
const MIX_PREFIX = 'RD';

/**
 * 1) FIRST STAGE SQL — pick 2000 oldest playlists by created_at
 * No JOIN, no GROUP BY → super fast
 */
const PRESELECT_SQL = `
  SELECT id, external_id, created_at
  FROM playlists
  ORDER BY created_at ASC
  LIMIT ${PRESELECT_LIMIT}
`;

/**
 * 2) SECOND STAGE SQL — compute track counts only for those 2000
 */
const TRACK_COUNTS_SQL = `
  SELECT
    p.id,
    p.title,
    p.external_id,
    p.last_refreshed_on,
    COUNT(t.id)::int AS track_count
  FROM playlists p
  LEFT JOIN playlist_tracks pt ON pt.playlist_id = p.id
  LEFT JOIN tracks t ON t.id = pt.track_id
  WHERE p.id = ANY($1::uuid[])
  GROUP BY p.id, p.title, p.external_id, p.last_refreshed_on
`;

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

type RawPreRow = {
  id: string;
  external_id: string | null;
  created_at: string;
};

type RawTrackRow = {
  id: string;
  title: string | null;
  external_id: string | null;
  last_refreshed_on: string | null;
  track_count: number;
};

export async function executePrepareJob(job: RefreshJobRow): Promise<void> {
  const scheduledLocal = DateTime.fromISO(job.scheduled_at, { zone: 'utc' }).setZone(TIMEZONE);
  console.log('[PrepareBatch] Starting job', {
    jobId: job.id,
    type: job.type,
    scheduledAtBudapest: scheduledLocal.toISO(),
  });

  if (job.type !== 'prepare') {
    await finalizeJob(job.id, { error: `Unexpected job type ${job.type}` });
    return;
  }

  try {
    await fs.mkdir(BATCH_DIR, { recursive: true });

    const playlists = await fetchEligiblePlaylists();

    const batchPayload = playlists.map((p) => ({
      playlistId: p.id,
      title: p.title ?? '',
      lastRefreshedOn: p.last_refreshed_on,
      trackCount: p.track_count,
    }));

    const fileName = `batch_${job.day_key}_slot_${job.slot_index}.json`;
    const filePath = path.join(BATCH_DIR, fileName);
    await fs.writeFile(filePath, JSON.stringify(batchPayload, null, 2), 'utf-8');

    await finalizeJob(job.id, { file: filePath, entries: batchPayload });
  } catch (err) {
    console.error('[PrepareBatch] Error', err);
    await finalizeJob(job.id, { error: (err as Error).message });
  }
}

/**
 * FULL LOGIC:
 * - Preselect 2000 oldest playlists
 * - Fetch track counts only for them
 * - Filter RD*
 * - Filter <10 tracks
 * - Sort by last_refreshed_on
 * - Limit 200
 */
async function fetchEligiblePlaylists() {
  const pre = await runRawQuery<RawPreRow>(PRESELECT_SQL);
  const ids = pre.map((r) => r.id);

  if (ids.length === 0) return [];

  // ❗ FIX: params must be `ids`, NOT `[ids]`
  const { data, error } = await supabase.rpc('run_raw_with_params', {
    sql: TRACK_COUNTS_SQL,
    params: ids, // <--- CORRECT
  });

  if (error) throw error;

  const rows = data as RawTrackRow[];

  const filtered = rows
    .filter((r) => !(r.external_id ?? '').toUpperCase().startsWith(MIX_PREFIX)) // remove RD*
    .filter((r) => r.track_count >= 10)
    .sort((a, b) => {
      const A = a.last_refreshed_on ?? '';
      const B = b.last_refreshed_on ?? '';
      return A.localeCompare(B);
    })
    .slice(0, PLAYLIST_LIMIT);

  return filtered;
}

async function runRawQuery<T>(sql: string): Promise<T[]> {
  const { data, error } = await supabase.rpc('run_raw', { sql });
  if (error) throw error;
  return (data as T[]) ?? [];
}

async function finalizeJob(jobId: string, payload: Record<string, unknown>) {
  const { error } = await supabase
    .from(JOB_TABLE)
    .update({ status: 'done', payload })
    .eq('id', jobId);

  if (error) console.error('Failed to update job', error);
}
