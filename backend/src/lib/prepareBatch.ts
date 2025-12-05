import path from 'path';
import { promises as fs } from 'fs';
import { DateTime } from 'luxon';
import supabase from '../services/supabaseClient';

const TIMEZONE = 'Europe/Budapest';
const PLAYLIST_LIMIT = 200;
const PRESELECT_LIMIT = 2000;
const BATCH_DIR = path.resolve(__dirname, '../../tmp/refresh_batches');
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

type Row = {
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

    const batchPayload = playlists.map(p => ({
      playlistId: p.id,
      title: p.title ?? '',
      lastRefreshedOn: p.last_refreshed_on,
      trackCount: p.track_count,
    }));

    const fileName = `batch_${job.day_key}_slot_${job.slot_index}.json`;
    const filePath = path.join(BATCH_DIR, fileName);

    await fs.writeFile(filePath, JSON.stringify(batchPayload, null, 2), 'utf-8');

    await finalizeJob(job.id, {
      file: filePath,
      entries: batchPayload.length,
    });
  } catch (err) {
    console.error('[PrepareBatch] Error', err);
    await finalizeJob(job.id, { error: (err as Error).message });
  }
}

/**
 * NEW LOGIC:
 * - Preselect 2000 playlists
 * - Join with view
 * - Filter RD mixes
 * - Filter ONLY empty playlists (track_count = 0)
 * - Sort by last_refreshed_on ASC
 * - Limit 200
 */
async function fetchEligiblePlaylists(): Promise<Row[]> {
  const sql = `
    with pre as (
      select id
      from playlists
      order by created_at asc
      limit ${PRESELECT_LIMIT}
    )
    select
      v.id,
      v.title,
      v.external_id,
      v.last_refreshed_on,
      v.track_count
    from v_playlist_track_counts v
    join pre on pre.id = v.id
    where not (v.external_id ilike '${MIX_PREFIX}%')
      and v.track_count = 0        -- EMPTY PLAYLISTS ONLY
    order by v.last_refreshed_on asc nulls first
    limit ${PLAYLIST_LIMIT}
  `;

  const { data, error } = await supabase.rpc('run_raw', { sql });

  if (error) throw error;

  return data as Row[];
}

async function finalizeJob(jobId: string, payload: Record<string, unknown>) {
  const { error } = await supabase
    .from(JOB_TABLE)
    .update({ status: 'done', payload })
    .eq('id', jobId);

  if (error) {
    console.error('Failed to update job', error);
  }
}
