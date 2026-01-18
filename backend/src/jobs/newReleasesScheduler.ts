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

  cron.schedule('30 6 * * *', async () => {
    if (running) {
      console.log('[NewReleases] Skip run because previous job is still running');
      return;
    }
    running = true;
    const hour = new Date().getHours();
    console.log('[NewReleases] Run start', { hour });
    try {
      await refreshNewReleasesSnapshot('daily cron');
      console.log('[NewReleases] Daily snapshot generated');
    } catch (err: any) {
      console.error('[NewReleases] Daily snapshot failed', err?.message || err);
    } finally {
      running = false;
    }
  });

  scheduled = true;
  console.log('[NewReleases] Scheduled daily at 06:30 local time');
}

export async function warmNewReleasesSnapshotIfMissing() {
  if (!env.enable_run_jobs) return;
  await ensureNewReleasesWarmStart();
}
