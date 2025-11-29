import path from 'path';
import { promises as fs } from 'fs';
import { DateTime } from 'luxon';
import supabase from '../services/supabaseClient';

const TIMEZONE = 'Europe/Budapest';
const PLAYLIST_LIMIT = 200;
const BATCH_DIR = path.resolve(__dirname, '../../tmp/refresh_batches');
const JOB_TABLE = 'refresh_jobs';
const MIX_PREFIX = 'RD';
const MIN_TRACKS = 10;
const MAX_TRACKS = 800;

const REAL_PLAYLISTS_BASE_SQL = `
  SELECT
    p.id,
    p.title,
    p.last_refreshed_on,
    p.external_id,
    COUNT(t.id)::int AS track_count
  FROM playlist_tracks pt
  JOIN tracks t ON t.id = pt.track_id
  JOIN playlists p ON p.id = pt.playlist_id
  GROUP BY p.id, p.title, p.last_refreshed_on, p.external_id
  HAVING COUNT(t.id) >= ${MIN_TRACKS}
`;

const TOTAL_REAL_SQL = `
  SELECT COUNT(*)::int AS count
  FROM (${REAL_PLAYLISTS_BASE_SQL}) AS eligible;
`;

const MIX_ONLY_SQL = `
  SELECT COUNT(*)::int AS count
  FROM (${REAL_PLAYLISTS_BASE_SQL}) AS eligible
  WHERE eligible.external_id ILIKE '${MIX_PREFIX}%';
`;

const FINAL_SELECTION_SQL = `
  SELECT id, title, last_refreshed_on, track_count
  FROM (${REAL_PLAYLISTS_BASE_SQL}) AS eligible
  WHERE (eligible.external_id IS NULL OR eligible.external_id NOT ILIKE '${MIX_PREFIX}%')
    AND eligible.track_count <= ${MAX_TRACKS}
  ORDER BY track_count ASC, last_refreshed_on ASC NULLS FIRST
  LIMIT ${PLAYLIST_LIMIT};
`;

const OVERSIZED_SQL = `
  SELECT COUNT(*)::int AS count
  FROM (${REAL_PLAYLISTS_BASE_SQL}) AS eligible
  WHERE eligible.track_count > ${MAX_TRACKS};
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

type PlaylistRow = {
  id: string;
  title: string | null;
  last_refreshed_on: string | null;
  track_count: number;
};

type CountRow = { count: number | string };
type RawPlaylistRow = { id: string; title: string | null; last_refreshed_on: string | null; track_count: number | string };

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
      trackCount: playlist.track_count,
    }));

    const fileName = `batch_${job.day_key}_slot_${job.slot_index}.json`;
    const filePath = path.join(BATCH_DIR, fileName);

    await fs.writeFile(filePath, JSON.stringify(batchPayload, null, 2), 'utf-8');
    console.log('[PrepareBatch] Batch file written', { filePath });

    await finalizeJob(job.id, { file: filePath, entries: batchPayload.length });
  } catch (error) {
    console.error('[PrepareBatch] Error while executing prepare job', error);
    await finalizeJob(job.id, { error: (error as Error).message || 'Unknown error' });
  }
}

async function fetchEligiblePlaylists(): Promise<PlaylistRow[]> {
  const totalRealEligible = await fetchCount(TOTAL_REAL_SQL);
  const mixExcluded = await fetchCount(MIX_ONLY_SQL);
  const oversizedExcluded = await fetchCount(OVERSIZED_SQL);
  const playlists = await fetchRealPlaylists();

  console.log('[prepare][real]', { totalRealEligible });
  console.log('[prepare][exclude] mixExcluded', { mixExcluded });
  console.log('[prepare][exclude] oversized', { skippedLarge: oversizedExcluded });
  console.log('[diagnostic][prepare]', { selected: playlists.length });

  if (playlists.length < PLAYLIST_LIMIT) {
    const availableAfterGuards = Math.max(totalRealEligible - mixExcluded - oversizedExcluded, 0);
    const reason = availableAfterGuards < PLAYLIST_LIMIT ? 'insufficient_real_playlists' : 'ordered_subset';
    console.warn('[diagnostic][prepare]', {
      message: 'Selected fewer playlists than requested',
      selected: playlists.length,
      availableAfterGuards,
      reason,
    });
  }

  return playlists;
}

async function fetchCount(sql: string): Promise<number> {
  const rows = await runRawQuery<CountRow>(sql);
  const value = rows[0]?.count ?? 0;
  const numeric = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(numeric) ? numeric : 0;
}

async function fetchRealPlaylists(): Promise<PlaylistRow[]> {
  const rows = await runRawQuery<RawPlaylistRow>(FINAL_SELECTION_SQL);
  return rows.map((row) => ({
    id: row.id,
    title: row.title ?? null,
    last_refreshed_on: row.last_refreshed_on,
    track_count: typeof row.track_count === 'number' ? row.track_count : Number(row.track_count) || 0,
  }));
}

async function runRawQuery<T>(sql: string): Promise<T[]> {
  const { data, error } = await supabase!.rpc('run_raw', { sql });

  if (error) {
    throw error;
  }

  return (data as T[] | null) ?? [];
}

async function finalizeJob(jobId: string, payload: Record<string, unknown>): Promise<void> {
  const { error } = await supabase!
    .from(JOB_TABLE)
    .update({ status: 'done', payload })
    .eq('id', jobId);

  if (error) {
    console.error('[PrepareBatch] Failed to update job status', { jobId, error: error.message });
  }
}
