import cron from 'node-cron';

import env from '../environments';
import { ensureTrendingWarmStart, refreshTrendingNowSnapshot } from '../services/trendingNow';

let scheduled = false;
let running = false;

export function scheduleTrendingNowJob() {
  if (!env.enable_run_jobs) {
    console.log('[TrendingNow] Scheduling disabled via ENABLE_RUN_JOBS=false');
    return;
  }

  if (scheduled) return;

  cron.schedule('0 6 * * *', async () => {
    if (running) {
      console.log('[TrendingNow] Skip run because previous job is still running');
      return;
    }
    running = true;
    const hour = new Date().getHours();
    console.log('[TrendingNow] Run start', { hour });
    try {
      await refreshTrendingNowSnapshot('daily cron');
      console.log('[TrendingNow] Daily snapshot generated');
    } catch (err: any) {
      console.error('[TrendingNow] Daily snapshot failed', err?.message || err);
    } finally {
      running = false;
    }
  });

  scheduled = true;
  console.log('[TrendingNow] Scheduled daily at 06:00 local time');
}

export async function warmTrendingSnapshotIfMissing() {
  if (!env.enable_run_jobs) return;
  await ensureTrendingWarmStart();
}
