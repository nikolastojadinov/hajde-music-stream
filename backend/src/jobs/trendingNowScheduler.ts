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

  cron.schedule(
    '0 2 * * 1',
    async () => {
      if (running) {
        console.log('[TrendingNow] Skip run because previous job is still running');
        return;
      }
      running = true;
      try {
        await refreshTrendingNowSnapshot('weekly cron');
        console.log('[TrendingNow] Weekly snapshot generated');
      } catch (err: any) {
        console.error('[TrendingNow] Weekly snapshot failed', err?.message || err);
      } finally {
        running = false;
      }
    },
    { timezone: 'UTC' }
  );

  scheduled = true;
  console.log('[TrendingNow] Weekly cron scheduled for Mondays 02:00 UTC');
}

export async function warmTrendingSnapshotIfMissing() {
  if (!env.enable_run_jobs) return;
  await ensureTrendingWarmStart();
}
