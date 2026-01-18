import cron from 'node-cron';

import env from '../environments';
import { ensureMostPopularWarmStart, refreshMostPopularSnapshot } from '../services/mostPopular';

let scheduled = false;
let running = false;

export function scheduleMostPopularJob() {
  if (!env.enable_run_jobs) {
    console.log('[MostPopular] Scheduling disabled via ENABLE_RUN_JOBS=false');
    return;
  }

  if (scheduled) return;

  cron.schedule('15 6 * * *', async () => {
    if (running) {
      console.log('[MostPopular] Skip run because previous job is still running');
      return;
    }
    running = true;
    const hour = new Date().getHours();
    console.log('[MostPopular] Run start', { hour });
    try {
      await refreshMostPopularSnapshot('daily cron');
      console.log('[MostPopular] Daily snapshot generated');
    } catch (err: any) {
      console.error('[MostPopular] Daily snapshot failed', err?.message || err);
    } finally {
      running = false;
    }
  });

  scheduled = true;
  console.log('[MostPopular] Scheduled daily at 06:15 local time');
}

export async function warmMostPopularSnapshotIfMissing() {
  if (!env.enable_run_jobs) return;
  await ensureMostPopularWarmStart();
}
