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

  cron.schedule(
    '10 2 * * 1',
    async () => {
      if (running) {
        console.log('[MostPopular] Skip run because previous job is still running');
        return;
      }
      running = true;
      try {
        await refreshMostPopularSnapshot('weekly cron');
        console.log('[MostPopular] Weekly snapshot generated');
      } catch (err: any) {
        console.error('[MostPopular] Weekly snapshot failed', err?.message || err);
      } finally {
        running = false;
      }
    },
    { timezone: 'UTC' }
  );

  scheduled = true;
  console.log('[MostPopular] Weekly cron scheduled for Mondays 02:10 UTC');
}

export async function warmMostPopularSnapshotIfMissing() {
  if (!env.enable_run_jobs) return;
  await ensureMostPopularWarmStart();
}
