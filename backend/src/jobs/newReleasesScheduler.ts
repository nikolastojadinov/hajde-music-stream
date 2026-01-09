import cron from 'node-cron';

import env from '../environments';
import { ensureNewReleasesWarmStart, refreshNewReleasesSnapshot } from '../services/newReleases';

let scheduled = false;
let running = false;

export function scheduleNewReleasesJob() {
  if (!env.enable_run_jobs) {
    console.log('[NewReleases] Scheduling disabled via ENABLE_RUN_JOBS=false');
    return;
  }

  if (scheduled) return;

  cron.schedule(
    '20 2 * * 1',
    async () => {
      if (running) {
        console.log('[NewReleases] Skip run because previous job is still running');
        return;
      }
      running = true;
      try {
        await refreshNewReleasesSnapshot('weekly cron');
        console.log('[NewReleases] Weekly snapshot generated');
      } catch (err: any) {
        console.error('[NewReleases] Weekly snapshot failed', err?.message || err);
      } finally {
        running = false;
      }
    },
    { timezone: 'UTC' }
  );

  scheduled = true;
  console.log('[NewReleases] Weekly cron scheduled for Mondays 02:20 UTC');
}

export async function warmNewReleasesSnapshotIfMissing() {
  if (!env.enable_run_jobs) return;
  await ensureNewReleasesWarmStart();
}
