import env from '../environments';
import { scheduleTrendingNowJob } from '../jobs/trendingNowScheduler';
import { scheduleMostPopularJob } from '../jobs/mostPopularScheduler';
import { scheduleNewReleasesJob } from '../jobs/newReleasesScheduler';
import { scheduleUnresolvedArtistJob } from './backgroundArtistScheduler';
import { scheduleArtistSuggestBatchJob } from '../jobs/artistSuggestBatchScheduler';

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
  scheduleUnresolvedArtistJob();
  scheduleTrendingNowJob();
  scheduleMostPopularJob();
  scheduleNewReleasesJob();
  scheduleArtistSuggestBatchJob();

  console.log('[Scheduler] Registered jobs:');
  console.log('- NightlyArtistIngest: every 5 minutes, 24/7');
  console.log('- TrendingNow: daily at 06:00 local time');
  console.log('- MostPopular: daily at 06:15 local time');
  console.log('- NewReleases: daily at 06:30 local time');
  console.log('- ArtistSuggestBatch: every minute (24/7)');
}
