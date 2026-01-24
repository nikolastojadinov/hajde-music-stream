import cron from 'node-cron';

import env from '../environments';
import { DAILY_ARTIST_SUGGEST_CRON, runArtistSuggestTick } from './ArtistSuggestBatch';

const JOB_LOG_CONTEXT = '[ArtistSuggestBatch]';
const SCHEDULER_TIMEZONE = process.env.TZ || 'UTC';
let scheduled = false;
let running = false;

export function scheduleArtistSuggestBatchJob(): void {
  if (!env.enable_run_jobs) {
    console.log(`${JOB_LOG_CONTEXT} scheduling_disabled`);
    return;
  }
  if (scheduled) return;

  cron.schedule(DAILY_ARTIST_SUGGEST_CRON, async () => {
    if (running) {
      console.log(`${JOB_LOG_CONTEXT} skip_concurrent_run`);
      return;
    }

    running = true;
    const hour = new Date().toLocaleString('en-US', { timeZone: SCHEDULER_TIMEZONE, hour: '2-digit', hour12: false });
    console.log(`${JOB_LOG_CONTEXT} run_start`, { hour, cron: DAILY_ARTIST_SUGGEST_CRON });

    try {
      await runArtistSuggestTick();
      console.log(`${JOB_LOG_CONTEXT} run_complete`);
    } catch (err) {
      console.error(`${JOB_LOG_CONTEXT} run_failed`, err instanceof Error ? err.message : String(err));
    } finally {
      running = false;
    }
  }, { timezone: SCHEDULER_TIMEZONE });

  scheduled = true;
  console.log(`${JOB_LOG_CONTEXT} scheduled`, { cron: DAILY_ARTIST_SUGGEST_CRON, timezone: SCHEDULER_TIMEZONE });
}
