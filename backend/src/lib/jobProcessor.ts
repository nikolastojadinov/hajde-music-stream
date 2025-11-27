import cron from 'node-cron';
import { DateTime } from 'luxon';
import supabase from '../services/supabaseClient';
import { executePrepareJob } from './prepareBatch';
import { executeRunJob } from '../jobs/runBatch';
import env from '../environments';

const TIMEZONE = 'Europe/Budapest';
const CRON_EXPRESSION = '* * * * *';
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

export function initJobProcessor(): void {
  if (!supabase) {
    console.warn('[jobProcessor] Supabase client unavailable; processor disabled');
    return;
  }

  cron.schedule(
    CRON_EXPRESSION,
    () => {
      const budapestNow = DateTime.now().setZone(TIMEZONE).toISO();
      console.log(`[jobProcessor] Tick at ${budapestNow}`);
      void processPendingJobs();
    },
    { timezone: TIMEZONE }
  );

  console.log(`[jobProcessor] Scheduled every minute in ${TIMEZONE}`);
}

async function processPendingJobs(): Promise<void> {
  if (!supabase) {
    console.error('[jobProcessor] Supabase client missing during tick');
    return;
  }

  const nowUtc = new Date().toISOString();

  try {
    const { data, error } = await supabase
      .from(JOB_TABLE)
      .select('*')
      .eq('status', 'pending')
      .lte('scheduled_at', nowUtc)
      .order('scheduled_at', { ascending: true });

    if (error) {
      console.error('[jobProcessor] Failed to fetch pending jobs', error);
      return;
    }

    if (!data || data.length === 0) {
      return;
    }

    for (const job of data as RefreshJobRow[]) {
      await handleJob(job);
    }
  } catch (error) {
    console.error('[jobProcessor] Unexpected error while processing tick', error);
  }
}

async function handleJob(job: RefreshJobRow): Promise<void> {
  console.log(
    `[jobProcessor] Executing job ${job.id} type=${job.type} slot=${job.slot_index} scheduled_at=${job.scheduled_at}`
  );

  const { data: lockedRows, error: lockError } = await supabase!
    .from(JOB_TABLE)
    .update({ status: 'running' })
    .eq('id', job.id)
    .eq('status', 'pending')
    .select('id');

  if (lockError) {
    console.error('[jobProcessor] Failed to lock job', { jobId: job.id, error: lockError });
    return;
  }

  if (!lockedRows || lockedRows.length === 0) {
    return;
  }

  try {
    if (job.type === 'prepare') {
      await executePrepareJob(job);

    } else if (job.type === 'run') {
      if (!env.enable_run_jobs) {
        console.warn(
          `[jobProcessor] RUN jobs disabled via env — skipping job ${job.id} (slot ${job.slot_index})`
        );
        await markJobSkipped(job.id, 'run jobs disabled via env flag');
        return;
      }

      await executeRunJob(job);
    } else {
      throw new Error(`Unsupported job type ${job.type}`);
    }

    await markJobDone(job.id);
  } catch (error) {
    const reason = error instanceof Error ? error.message : 'Unknown error';
    console.error('[jobProcessor] Job execution failed', { jobId: job.id, reason });
    await markJobError(job.id, reason);
  }
}

async function markJobDone(jobId: string): Promise<void> {
  const { error } = await supabase!.from(JOB_TABLE).update({ status: 'done' }).eq('id', jobId);

  if (error) {
    console.error('[jobProcessor] Failed to mark job done', { jobId, error });
  }
}

async function markJobError(jobId: string, reason: string): Promise<void> {
  const payload = { error: reason };
  const { error } = await supabase!
    .from(JOB_TABLE)
    .update({ status: 'error', payload })
    .eq('id', jobId);

  if (error) {
    console.error('[jobProcessor] Failed to mark job error', { jobId, error });
  }
}

async function markJobSkipped(jobId: string, reason: string): Promise<void> {
  const payload = { skipped: true, reason };
  const { error } = await supabase!
    .from(JOB_TABLE)
    .update({ status: 'done', payload })
    .eq('id', jobId);

  if (error) {
    console.error('[jobProcessor] Failed to mark job skipped', { jobId, error });
  }
}
