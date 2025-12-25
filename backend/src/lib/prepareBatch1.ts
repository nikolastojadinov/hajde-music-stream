// backend/src/lib/prepareBatch1.ts
// FULL REWRITE — SLOT-AWARE, STRICT CONTRACT WITH runBatch

import path from 'path';
import { promises as fs } from 'fs';
import { DateTime } from 'luxon';
import supabase from '../services/supabaseClient';

const TIMEZONE = 'Europe/Budapest';
const CHANNEL_LIMIT = 200;
const BATCH_DIR = path.resolve(__dirname, '../../tmp/refresh_batches');
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

type SeedChannelRow = {
  channel_id: string;
};

type BatchFileEntry = {
  channelId: string;
};

export async function executePrepareJob(job: RefreshJobRow): Promise<void> {
  const scheduledLocal = DateTime
    .fromISO(job.scheduled_at, { zone: 'utc' })
    .setZone(TIMEZONE);

  console.log('[PrepareBatch1] Starting', {
    jobId: job.id,
    slot: job.slot_index,
    scheduledAt: scheduledLocal.toISO(),
  });

  if (job.type !== 'prepare') {
    await finalizeJob(job.id, { error: 'Invalid job type' });
    return;
  }

  try {
    await fs.mkdir(BATCH_DIR, { recursive: true });

    const channels = await fetchSeedChannels();

    if (channels.length === 0) {
      throw new Error('No seed channels available');
    }

    const payload: BatchFileEntry[] = channels.map(c => ({
      channelId: c.channel_id,
    }));

    // 🔑 SLOT-AWARE FILE NAME — MUST MATCH runBatch
    const filePath = path.join(
      BATCH_DIR,
      `batch_${job.day_key}_slot_${job.slot_index}.json`,
    );

    await fs.writeFile(
      filePath,
      JSON.stringify(payload, null, 2),
      'utf-8',
    );

    await finalizeJob(job.id, {
      file: filePath,
      slot: job.slot_index,
      channels: payload.length,
    });

    console.log('[PrepareBatch1] Completed', {
      slot: job.slot_index,
      count: payload.length,
      filePath,
    });
  } catch (err) {
    console.error('[PrepareBatch1] Error', err);

    await finalizeJob(job.id, {
      error: err instanceof Error ? err.message : 'Unknown error',
    });
  }
}

async function fetchSeedChannels(): Promise<SeedChannelRow[]> {
  const { data, error } = await supabase
    .from('seeds_channels')
    .select('channel_id')
    .order('added_on', { ascending: true })
    .limit(CHANNEL_LIMIT);

  if (error) {
    throw new Error(`Failed to fetch seed channels: ${error.message}`);
  }

  return (data ?? []).filter(
    r => typeof r.channel_id === 'string' && r.channel_id.trim().length > 0,
  );
}

async function finalizeJob(
  jobId: string,
  payload: Record<string, unknown>,
): Promise<void> {
  const { error } = await supabase
    .from(JOB_TABLE)
    .update({
      status: 'done',
      payload,
    })
    .eq('id', jobId);

  if (error) {
    console.error('[PrepareBatch1] Failed to update job', {
      jobId,
      error: error.message,
    });
  }
}
