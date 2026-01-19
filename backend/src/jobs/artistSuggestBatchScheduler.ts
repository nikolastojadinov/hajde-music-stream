import cron from 'node-cron';

import env from '../environments';
import { DAILY_ARTIST_SUGGEST_CRON, runDailyArtistSuggestBatch } from '../services/suggestIndexer';

const JOB_LOG_CONTEXT = '[ArtistSuggestBatch]';
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
    const hour = new Date().getHours();
    console.log(`${JOB_LOG_CONTEXT} run_start`, { hour, cron: DAILY_ARTIST_SUGGEST_CRON });

    try {
      await runDailyArtistSuggestBatch();
      console.log(`${JOB_LOG_CONTEXT} run_complete`);
    } catch (err) {
      console.error(`${JOB_LOG_CONTEXT} run_failed`, err instanceof Error ? err.message : String(err));
    } finally {
      running = false;
    }
  });

  scheduled = true;
  console.log(`${JOB_LOG_CONTEXT} scheduled`, { cron: DAILY_ARTIST_SUGGEST_CRON });
}
