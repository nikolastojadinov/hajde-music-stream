import cron from 'node-cron';

import env from '../environments';
import { runInnertubeDecoderOnce } from '../services/innertubeDecoder';

let scheduled = false;
let running = false;

export function scheduleInnertubeDecoderJob() {
  if (!env.enable_run_jobs) {
    console.log('[InnertubeDecoder] Scheduling disabled via ENABLE_RUN_JOBS=false');
    return;
  }

  if (!env.enable_innertube_decoder) {
    console.log('[InnertubeDecoder] Scheduling disabled via ENABLE_INNERTUBE_DECODER=false');
    return;
  }

  if (scheduled) return;

  cron.schedule('* * * * *', async () => {
    if (running) {
      console.log('[InnertubeDecoder] Skip run because previous job is still running');
      return;
    }
    running = true;
    try {
      await runInnertubeDecoderOnce();
    } catch (err: any) {
      console.error('[InnertubeDecoder] run failed', err?.message || err);
    } finally {
      running = false;
    }
  });

  scheduled = true;
  console.log('[InnertubeDecoder] Cron scheduled: every minute');
}
