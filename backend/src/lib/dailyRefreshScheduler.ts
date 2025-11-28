import cron from 'node-cron';
import { DateTime } from 'luxon';
import { randomUUID } from 'crypto';
import supabase from '../services/supabaseClient';

const TIMEZONE = 'Europe/Budapest';
const CRON_EXPRESSION = '5 11 * * *'; // 11:05 local time daily
const TABLE_NAME = 'refresh_jobs';
const PREPARE_TIMES = ['09:15', '10:15', '11:15', '12:15', '13:15', '14:15', '15:15', '16:15', '17:15', '18:15'];
const RUN_TIMES = ['10:00', '11:00', '12:00', '13:00', '14:00', '15:00', '16:00', '17:00', '18:00', '19:00'];

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

export function initDailyRefreshScheduler() {
  if (!supabase) {
    console.warn('[DailyRefreshScheduler] Supabase client unavailable; scheduler disabled');
    return;
  }

  cron.schedule(
    CRON_EXPRESSION,
    () => {
      console.log('[DailyRefreshScheduler] Cron fired, generating fixed slots');
      void generateDailySlots();
    },
    { timezone: TIMEZONE }
  );

  console.log('[DailyRefreshScheduler] Cron scheduled for 11:05 Europe/Budapest');
}

async function generateDailySlots(): Promise<void> {
  const now = DateTime.now().setZone(TIMEZONE);
  const dayKey = now.toISODate();

  if (!dayKey) {
    console.error('[DailyRefreshScheduler] Failed to compute day_key');
    return;
  }

  try {
    const existing = await supabase
      .from(TABLE_NAME)
      .select('id')
      .eq('day_key', dayKey)
      .limit(1);

    if (existing.error) {
      throw existing.error;
    }

    if (existing.data && existing.data.length > 0) {
      console.log(`[DailyRefreshScheduler] Slots for ${dayKey} already exist – skipping generation`);
      return;
    }

    const jobs = buildFixedJobs(dayKey);
    const insertResult = await supabase.from(TABLE_NAME).insert(jobs);

    if (insertResult.error) {
      throw insertResult.error;
    }

    console.log(`[DailyRefreshScheduler] Created ${jobs.length} refresh_jobs rows for ${dayKey}`);
  } catch (error) {
    console.error('[DailyRefreshScheduler] Failed to create slots', error);
  }
}

function buildFixedJobs(dayKey: string): RefreshJobRow[] {
  const prepareJobs = PREPARE_TIMES.map((time, index) =>
    createJobRow(index, 'prepare', buildLocalDate(dayKey, time), dayKey)
  );

  const runJobs = RUN_TIMES.map((time, index) =>
    createJobRow(index, 'run', buildLocalDate(dayKey, time), dayKey)
  );

  return [...prepareJobs, ...runJobs];
}

function buildLocalDate(dayKey: string, time: string): DateTime {
  const iso = `${dayKey}T${time}:00`;
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
