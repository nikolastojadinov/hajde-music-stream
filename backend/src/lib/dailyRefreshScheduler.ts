import cron from 'node-cron';
import { DateTime } from 'luxon';
import { randomUUID } from 'crypto';
import supabase from '../services/supabaseClient';

const TIMEZONE = 'Europe/Budapest';
const CRON_EXPRESSION = '5 11 * * *'; // 11:05 daily
const SLOT_COUNT = 10;
const PREPARE_OFFSET_MINUTES = 15;
const TABLE_NAME = 'refresh_jobs';

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
      console.log('[DailyRefreshScheduler] Cron fired, generating slots');
      void generateDailySlots();
    },
    { timezone: TIMEZONE }
  );

  console.log('[DailyRefreshScheduler] Cron scheduled for 11:05 Europe/Budapest');
}

async function generateDailySlots(): Promise<void> {
  const now = DateTime.now().setZone(TIMEZONE);
  const dayKey = now.toISODate() ?? now.toFormat('yyyy-MM-dd');
  const windowStart = now.set({ hour: 11, minute: 30, second: 0, millisecond: 0 });
  const windowEnd = now.plus({ days: 1 }).set({ hour: 8, minute: 0, second: 0, millisecond: 0 });

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

    const runSlots = generateRandomSlots(SLOT_COUNT, windowStart, windowEnd);
    const jobs = buildJobRows(runSlots, dayKey);

    const insertResult = await supabase.from(TABLE_NAME).insert(jobs);
    if (insertResult.error) {
      throw insertResult.error;
    }

    console.log(`[DailyRefreshScheduler] Created ${jobs.length} refresh_jobs rows for ${dayKey}`);
  } catch (error) {
    console.error('[DailyRefreshScheduler] Failed to create slots', error);
  }
}

function generateRandomSlots(count: number, start: DateTime, end: DateTime): DateTime[] {
  const startMillis = start.toMillis();
  const endMillis = end.toMillis();

  if (endMillis <= startMillis) {
    throw new Error('[DailyRefreshScheduler] Invalid window: end must be after start');
  }

  const range = endMillis - startMillis;
  const slots: DateTime[] = [];

  for (let i = 0; i < count; i += 1) {
    const offset = Math.random() * range;
    const slotMillis = startMillis + offset;
    slots.push(DateTime.fromMillis(slotMillis, { zone: TIMEZONE }));
  }

  return slots.sort((a, b) => a.toMillis() - b.toMillis());
}

function buildJobRows(slots: DateTime[], dayKey: string): RefreshJobRow[] {
  const rows: RefreshJobRow[] = [];

  slots.forEach((slot, index) => {
    const prepareSlot = slot.minus({ minutes: PREPARE_OFFSET_MINUTES });

    rows.push(createJobRow(index, 'prepare', prepareSlot, dayKey));
    rows.push(createJobRow(index, 'run', slot, dayKey));
  });

  return rows;
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
