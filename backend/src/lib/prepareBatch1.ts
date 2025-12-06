import path from 'path';
import { promises as fs } from 'fs';
import { DateTime } from 'luxon';
import supabase from '../services/supabaseClient';

const TIMEZONE = 'Europe/Budapest';
const PLAYLIST_LIMIT = 200;
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
  created_at: string | null;
};

export async function executePrepareJob(job: RefreshJobRow): Promise<void> {
  const scheduledLocal = DateTime.fromISO(job.scheduled_at, { zone: 'utc' }).setZone(TIMEZONE);

  console.log('[PrepareBatch1] Starting job', {
    jobId: job.id,
    type: job.type,
    scheduledAtBudapest: scheduledLocal.toISO()
  });

  if (job.type !== 'prepare') {
    await finalizeJob(job.id, { error: `Unexpected job type ${job.type}` });
    return;
  }

  try {
    await fs.mkdir(BATCH_DIR, { recursive: true });

    const playlists = await fetchEmptyPlaylists();

    const batchPayload = playlists.map(p => ({
      playlistId: p.id,
      title: p.title ?? '',
      lastRefreshedOn: null,
      trackCount: 0
    }));

    const fileName = `batch_${job.day_key}_slot_${job.slot_index}.json`;
    const filePath = path.join(BATCH_DIR, fileName);

    await fs.writeFile(filePath, JSON.stringify(batchPayload, null, 2), 'utf-8');

    await finalizeJob(job.id, {
      file: filePath,
      entries: batchPayload.length
    });
  } catch (err) {
    console.error('[PrepareBatch1] Error', err);
    await finalizeJob(job.id, { error: (err as Error).message });
  }
}

/**
 * SELECTS ONLY EMPTY PLAYLISTS (no tracks in playlist_tracks)
 * - Not RD*
 * - Ordered by created_at
 * - Limit 200
 */
async function fetchEmptyPlaylists(): Promise<Row[]> {
  const sql = `
    with empty_playlists as (
      select p.id, p.title, p.external_id, p.created_at
      from playlists p
      left join playlist_tracks pt on pt.playlist_id = p.id
      where pt.playlist_id is null
        and not (p.external_id ilike '${MIX_PREFIX}%')
    )
    select id, title, external_id, created_at
    from empty_playlists
    order by created_at asc
    limit ${PLAYLIST_LIMIT}
  `; // <-- NEMA ; !!!

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
