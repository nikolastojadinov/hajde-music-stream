// backend/src/lib/prepareBatch1.ts

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
  last_refreshed_on: string | null;
};

export async function executePrepareJob(job: RefreshJobRow): Promise<void> {
  const scheduledLocal = DateTime.fromISO(job.scheduled_at, { zone: 'utc' }).setZone(TIMEZONE);

  console.log('[PrepareBatch1] Starting prepare job', {
    jobId: job.id,
    slot: job.slot_index,
    dayKey: job.day_key,
    scheduledAtBudapest: scheduledLocal.toISO()
  });

  if (job.type !== 'prepare') {
    await finalizeJob(job.id, { error: `Unexpected job type ${job.type}` });
    return;
  }

  try {
    await fs.mkdir(BATCH_DIR, { recursive: true });

    // ✔ bira najstarije prazne plejliste
    const playlists = await fetchLeastRefreshedEmptyPlaylists();

    console.log('[PrepareBatch1] Playlists fetched:', playlists.length);

    const batchPayload = playlists.map((p) => ({
      playlistId: p.id,
      title: p.title ?? '',
      externalId: p.external_id,
      createdAt: p.created_at,
      lastRefreshedOn: p.last_refreshed_on,
    }));

    const filePath = path.join(
      BATCH_DIR,
      `batch_${job.day_key}_slot_${job.slot_index}.json`
    );

    await fs.writeFile(filePath, JSON.stringify(batchPayload, null, 2), 'utf-8');

    await finalizeJob(job.id, {
      file: filePath,
      entries: batchPayload.length,
    });

    console.log('[PrepareBatch1] Job completed', {
      jobId: job.id,
      count: batchPayload.length,
      filePath,
    });
  } catch (err) {
    console.error('[PrepareBatch1] Error', err);
    await finalizeJob(job.id, { error: (err as Error).message });
  }
}

/**
 * ✔ BIRA SAMO PRAZNE PLEJLISTE
 * ✔ SORTIRA po last_refreshed_on ASC NULLS FIRST
 * ✔ RETRY mehanizam ×3 za timeout greške
 */
async function fetchLeastRefreshedEmptyPlaylists(): Promise<Row[]> {
  const MAX_RETRIES = 3;
  const RETRY_DELAY_MS = 1500;

  const sql = `
    select
      p.id,
      p.title,
      p.external_id,
      p.created_at,
      p.last_refreshed_on
    from playlists p
    left join playlist_tracks pt
      on pt.playlist_id = p.id
    where pt.playlist_id is null
      and p.external_id is not null
      and p.external_id ~ '^[A-Za-z0-9_-]{16,}$'
      and not (p.external_id ilike '${MIX_PREFIX}%')
    order by
      p.last_refreshed_on asc nulls first,
      p.created_at asc
    limit ${PLAYLIST_LIMIT}
  `;

  let attempt = 0;

  while (attempt < MAX_RETRIES) {
    attempt++;

    console.log(`[PrepareBatch1] SQL attempt ${attempt}/${MAX_RETRIES}`);

    const { data, error } = await supabase.rpc('run_raw', { sql });

    if (!error) {
      return data as Row[];
    }

    const message = (error as any).message ?? '';

    // Retry samo na timeout
    if (
      message.includes("statement timeout") ||
      message.includes("canceling statement due to statement timeout")
    ) {
      console.warn(
        `[PrepareBatch1] SQL timeout on attempt ${attempt}, retrying...`
      );

      if (attempt < MAX_RETRIES) {
        await new Promise((res) => setTimeout(res, RETRY_DELAY_MS));
        continue;
      }
    }

    console.error('[PrepareBatch1] SQL error:', error);
    throw error;
  }

  throw new Error(`fetchLeastRefreshedEmptyPlaylists failed after ${MAX_RETRIES} attempts`);
}

async function finalizeJob(jobId: string, payload: Record<string, unknown>) {
  const { error } = await supabase
    .from(JOB_TABLE)
    .update({ status: 'done', payload })
    .eq('id', jobId);

  if (error) {
    console.error('[PrepareBatch1] Failed to update job status', error);
  }
}
