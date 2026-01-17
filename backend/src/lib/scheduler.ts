import { scheduleMostPopularJob, warmMostPopularSnapshotIfMissing } from '../jobs/mostPopularScheduler';
import { scheduleNewReleasesJob, warmNewReleasesSnapshotIfMissing } from '../jobs/newReleasesScheduler';
import { scheduleTrendingNowJob, warmTrendingSnapshotIfMissing } from '../jobs/trendingNowScheduler';
import { scheduleInnertubeDecoderJob } from '../jobs/innertubeDecoderScheduler';
import { scheduleBackgroundArtistJob } from './backgroundArtistScheduler';

let initialized = false;

export function registerSchedulers(): void {
  if (initialized) return;

  scheduleBackgroundArtistJob();
  scheduleTrendingNowJob();
  void warmTrendingSnapshotIfMissing();
  scheduleMostPopularJob();
  void warmMostPopularSnapshotIfMissing();
  scheduleNewReleasesJob();
  void warmNewReleasesSnapshotIfMissing();
  scheduleInnertubeDecoderJob();

  initialized = true;
  console.log('[Scheduler] Background jobs registered');
}
