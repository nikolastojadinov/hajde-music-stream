import env from '../environments';
import { scheduleTrendingNowJob } from '../jobs/trendingNowScheduler';
import { scheduleMostPopularJob } from '../jobs/mostPopularScheduler';
import { scheduleNewReleasesJob } from '../jobs/newReleasesScheduler';
import { scheduleUnresolvedArtistJob, type SchedulerWindow } from './backgroundArtistScheduler';

function parseHour(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value || '', 10);
  if (Number.isFinite(parsed) && parsed >= 0 && parsed < 24) return parsed;
  return fallback;
}

function resolveSchedulerWindow(): SchedulerWindow {
  const startHour = parseHour(process.env.BACKGROUND_INGEST_WINDOW_START, 0);
  const endHour = parseHour(process.env.BACKGROUND_INGEST_WINDOW_END, 5);
  return { startHour, endHour };
}

let initialized = false;

export function registerSchedulers(): void {
  if (initialized) return;
  initialized = true;

  console.log(`[Scheduler] ENABLE_RUN_JOBS=${env.enable_run_jobs}`);

  if (!env.enable_run_jobs) {
    console.log('[Scheduler] No background jobs registered');
    return;
  }

  console.log('[Scheduler] Registering background jobs');
  const window = resolveSchedulerWindow();
  scheduleUnresolvedArtistJob(window);
  scheduleTrendingNowJob();
  scheduleMostPopularJob();
  scheduleNewReleasesJob();

  console.log('[Scheduler] Registered jobs:');
  console.log('- NightlyArtistIngest: every 5 minutes between 00:00-05:00 local window');
  console.log('- TrendingNow: daily at 06:00 local time');
  console.log('- MostPopular: daily at 06:15 local time');
  console.log('- NewReleases: daily at 06:30 local time');
}
