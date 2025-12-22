// backend/src/lib/dailyRefreshScheduler.ts

import cron from 'node-cron';
import { DateTime } from 'luxon';
import { randomUUID } from 'crypto';
import supabase from '../services/supabaseClient';

const SCHEDULER_DISABLED = process.env.SCHEDULER_DISABLED === 'true';
let loggedDisabled = false;

const TIMEZONE = 'Europe/Budapest';
const CRON_EXPRESSION = '0 1 * * *'; // 01:00 local time daily
const TABLE_NAME = 'refresh_jobs';

const SLOT_COUNT = 20;
const PREPARE_START_HOUR = 1;
const PREPARE_START_MINUTE = 0;
const SLOT_INTERVAL_MINUTES = 60;
const PREPARE_TO_RUN_OFFSET_MINUTES = 60; // run starts 1h after prepare

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

function logDisabledOnce(): void {
  if (loggedDisabled) return;
  console.log('Scheduler disabled by env flag');
  loggedDisabled = true;
}

export function initDailyRefreshScheduler(): void {
  // Freeze switch: do not register any cron jobs when disabled.
  if (SCHEDULER_DISABLED) {
    logDisabledOnce();
    return;
  }

  if (!supabase) {
    console.warn('[DailyRefreshScheduler] Supabase client unavailable; scheduler disabled');
    return;
  }

  cron.schedule(
    CRON_EXPRESSION,
    () => {
      void generateDailySlots();
    },
    { timezone: TIMEZONE }
  );

  console.log('[DailyRefreshScheduler] Cron scheduled for 01:00 Europe/Budapest');
}

async function generateDailySlots(): Promise<void> {
  // Safety: even if called directly, do nothing while disabled.
  if (SCHEDULER_DISABLED) return;
  if (!supabase) return;

  const localNow = DateTime.now().setZone(TIMEZONE);
  const dayKey = localNow.toISODate();

  if (!dayKey) {
    console.error('[DailyRefreshScheduler] Failed to compute day_key');
    return;
  }

  try {
    const existing = await supabase.from(TABLE_NAME).select('id').eq('day_key', dayKey).limit(1);

    if (existing.error) {
      throw existing.error;
    }

    if (existing.data && existing.data.length > 0) {
      console.log(`[DailyRefreshScheduler] Slots for ${dayKey} already exist – skipping generation`);
      return;
    }

    const jobs = buildJobRows(dayKey);
    const insertResult = await supabase.from(TABLE_NAME).insert(jobs);

    if (insertResult.error) {
      throw insertResult.error;
    }

    console.log(`[DailyRefreshScheduler] Created ${jobs.length} refresh_jobs rows for ${dayKey}`);
  } catch (error) {
    console.error('[DailyRefreshScheduler] Failed to create slots', error);
  }
}

function buildJobRows(dayKey: string): RefreshJobRow[] {
  const rows: RefreshJobRow[] = [];
  const prepareStart = buildLocalDate(dayKey, PREPARE_START_HOUR, PREPARE_START_MINUTE);

  for (let slot = 0; slot < SLOT_COUNT; slot += 1) {
    const prepareTime = prepareStart.plus({ minutes: slot * SLOT_INTERVAL_MINUTES });
    const runTime = prepareTime.plus({ minutes: PREPARE_TO_RUN_OFFSET_MINUTES });

    rows.push(createJobRow(slot, 'prepare', prepareTime, dayKey));
    rows.push(createJobRow(slot, 'run', runTime, dayKey));
  }

  return rows;
}

function buildLocalDate(dayKey: string, hour: number, minute: number): DateTime {
  const iso = `${dayKey}T${hour.toString().padStart(2, '0')}:${minute
    .toString()
    .padStart(2, '0')}:00`;
  const date = DateTime.fromISO(iso, { zone: TIMEZONE });

  if (!date.isValid) {
    throw new Error(`[DailyRefreshScheduler] Invalid slot time: ${iso}`);
  }

  return date;
}

function createJobRow(index: number, type: JobType, scheduled: DateTime, dayKey: string): RefreshJobRow {
  const scheduledIso = scheduled.toUTC().toISO();

  if (!scheduledIso) {
    throw new Error('[DailyRefreshScheduler] Failed to format scheduled_at timestamp');
  }

  return {
    id: randomUUID(),
    slot_index: index,
    type,
    scheduled_at: scheduledIso,
    day_key: dayKey,
    status: 'pending',
    payload: {},
  };
}
