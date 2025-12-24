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
};

export async function executePrepareJob(job: RefreshJobRow): Promise<void> {
  const scheduledLocal = DateTime.fromISO(job.scheduled_at, { zone: 'utc' }).setZone(TIMEZONE);

  console.log('[PrepareBatch1] Starting', {
    jobId: job.id,
    scheduledAt: scheduledLocal.toISO(),
  });

  if (job.type !== 'prepare') {
    await finalizeJob(job.id, { error: 'Invalid job type' });
    return;
  }

  try {
    await fs.mkdir(BATCH_DIR, { recursive: true });

    const channels = await fetchSeedChannels();

    const payload = channels.map((c) => ({
      channelId: c.channel_id,
    }));

    const filePath = path.join(
      BATCH_DIR,
      `batch_${job.day_key}.json`
    );

    await fs.writeFile(filePath, JSON.stringify(payload, null, 2), 'utf-8');

    await finalizeJob(job.id, {
      file: filePath,
      channels: payload.length,
    });

    console.log('[PrepareBatch1] Completed', {
      count: payload.length,
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
    .select('channel_id')
    .order('added_on', { ascending: true })
    .limit(CHANNEL_LIMIT);

  if (error) throw error;
  return (data || []).filter((r) => r.channel_id && r.channel_id.trim().length > 0);
}

async function finalizeJob(jobId: string, payload: Record<string, unknown>): Promise<void> {
  const { error } = await supabase
    .from(JOB_TABLE)
    .update({ status: 'done', payload })
    .eq('id', jobId);

  if (error) {
    console.error('[PrepareBatch1] Failed to update job', error);
  }
}
