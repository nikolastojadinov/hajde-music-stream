// backend/src/lib/dailyRefreshScheduler.ts
// FULL REWRITE — ONLY Batch 1 (11:40 / 11:45 / 11:50)

import cron from 'node-cron';
import { DateTime } from 'luxon';
import { randomUUID } from 'crypto';
import supabase from '../services/supabaseClient';

const TIMEZONE = 'Europe/Budapest';
const TABLE_NAME = 'refresh_jobs';

/**
 * Scheduler runs every day at 11:40 local time (Europe/Budapest)
 * It creates:
 *  - prepare batch 1 at 11:45
 *  - run batch 1 at 11:50
 */
const CRON_EXPRESSION = '40 11 * * *'; // 11:40 Europe/Budapest

type JobType = 'prepare' | 'run';

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

  console.log('[DailyRefreshScheduler] Scheduled daily job generation at 11:40 Europe/Budapest');
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

    // Local schedule:
    // prepare batch 1 -> 11:45
    // run batch 1     -> 11:50
    const prepare1Time = buildLocalDate(dayKey, 11, 45);
    const run1Time = buildLocalDate(dayKey, 11, 50);

    const jobs: RefreshJobRow[] = [
      createJobRow(1, 'prepare', prepare1Time, dayKey),
      createJobRow(1, 'run', run1Time, dayKey),
    ];

    const { error } = await supabase.from(TABLE_NAME).insert(jobs);
    if (error) throw error;

    console.log(
      `[DailyRefreshScheduler] Created daily jobs for ${dayKey} (prepare1 11:45, run1 11:50)`
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
