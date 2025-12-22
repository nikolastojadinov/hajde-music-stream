// backend/src/lib/prepareBatch1.ts

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
  name?: string | null;
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

    // Channels are the new driver for batch jobs
    const channels = await fetchSeedChannels();

    console.log('[PrepareBatch1] Channels fetched:', channels.length);

    const batchPayload = channels.map((c) => ({
      channelId: c.channel_id,
      artist: c.name ?? undefined,
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

async function fetchSeedChannels(): Promise<SeedChannelRow[]> {
  const { data, error } = await supabase
    .from('seeds_channels')
    .select('channel_id, name')
    .order('added_on', { ascending: true })
    .limit(CHANNEL_LIMIT);

  if (error) {
    console.error('[PrepareBatch1] Failed to fetch seed channels', error);
    throw error;
  }

  const rows = Array.isArray(data) ? (data as SeedChannelRow[]) : [];
  return rows.filter((row) => typeof row.channel_id === 'string' && row.channel_id.trim().length > 0);
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
