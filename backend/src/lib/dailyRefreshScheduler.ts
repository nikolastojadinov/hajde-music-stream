// backend/src/lib/dailyRefreshScheduler.ts
// FULL REWRITE — adjusted daily schedule times (09:30 / 09:40 / 09:50 / 10:30)

import cron from 'node-cron';
import { DateTime } from 'luxon';
import { randomUUID } from 'crypto';
import supabase from '../services/supabaseClient';

const TIMEZONE = 'Europe/Budapest';

/**
 * Scheduler runs every day at 09:30 local time (Europe/Budapest)
 * It creates:
 *  - prepare job at 09:40
 *  - run job at 09:50
 *  - postbatch job at 10:30
 */
const CRON_EXPRESSION = '30 9 * * *'; // 09:30 Europe/Budapest

const TABLE_NAME = 'refresh_jobs';

type JobType = 'prepare' | 'run' | 'postbatch';

type RefreshJobRow = {
  id: string;
  slot_index: number;
  type: JobType;
  scheduled_at: string;
  day_key: string;
  status: 'pending';
  payload: Record<string, unknown>;
};

export function initDailyRefreshScheduler(): void {
  if (!supabase) {
    console.warn('[DailyRefreshScheduler] Supabase unavailable, scheduler disabled');
    return;
  }

  cron.schedule(
    CRON_EXPRESSION,
    () => {
      void generateDailyJobs();
    },
    { timezone: TIMEZONE }
  );

  console.log('[DailyRefreshScheduler] Scheduled at 09:30 Europe/Budapest');
}

async function generateDailyJobs(): Promise<void> {
  const localNow = DateTime.now().setZone(TIMEZONE);
  const dayKey = localNow.toISODate();

  if (!dayKey) return;

  try {
    const existing = await supabase
      .from(TABLE_NAME)
      .select('id')
      .eq('day_key', dayKey)
      .limit(1);

    if (existing.data && existing.data.length > 0) {
      console.log(`[DailyRefreshScheduler] Jobs already exist for ${dayKey}`);
      return;
    }

    // Job schedule (local time):
    // Prepare   -> 09:40
    // Run       -> 09:50
    // Postbatch -> 10:30
    const prepareTime = buildLocalDate(dayKey, 9, 40);
    const runTime = buildLocalDate(dayKey, 9, 50);
    const postBatchTime = buildLocalDate(dayKey, 10, 30);

    const jobs: RefreshJobRow[] = [
      createJobRow(0, 'prepare', prepareTime, dayKey),
      createJobRow(0, 'run', runTime, dayKey),
      createJobRow(0, 'postbatch', postBatchTime, dayKey),
    ];

    const { error } = await supabase.from(TABLE_NAME).insert(jobs);
    if (error) throw error;

    console.log(
      `[DailyRefreshScheduler] Created daily jobs for ${dayKey} (prepare 09:40, run 09:50, postbatch 10:30)`
    );
  } catch (err) {
    console.error('[DailyRefreshScheduler] Failed to create jobs', err);
  }
}

function buildLocalDate(dayKey: string, hour: number, minute: number): DateTime {
  return DateTime.fromISO(
    `${dayKey}T${hour.toString().padStart(2, '0')}:${minute
      .toString()
      .padStart(2, '0')}:00`,
    { zone: TIMEZONE }
  );
}

function createJobRow(
  slotIndex: number,
  type: JobType,
  scheduled: DateTime,
  dayKey: string
): RefreshJobRow {
  const scheduledIso = scheduled.toUTC().toISO();
  if (!scheduledIso) throw new Error('Invalid scheduled_at');

  return {
    id: randomUUID(),
    slot_index: slotIndex,
    type,
    scheduled_at: scheduledIso,
    day_key: dayKey,
    status: 'pending',
    payload: {},
  };
}
