import { scheduleMostPopularJob, warmMostPopularSnapshotIfMissing } from '../jobs/mostPopularScheduler';
import { scheduleNewReleasesJob, warmNewReleasesSnapshotIfMissing } from '../jobs/newReleasesScheduler';
import { scheduleTrendingNowJob, warmTrendingSnapshotIfMissing } from '../jobs/trendingNowScheduler';
import { scheduleInnertubeDecoderJob } from '../jobs/innertubeDecoderScheduler';
import { scheduleUnresolvedArtistJob } from './backgroundArtistScheduler';

export type SchedulerWindow = {
  startHour: number;
  endHour: number;
};

function parseHour(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value || '', 10);
  if (Number.isFinite(parsed) && parsed >= 0 && parsed < 24) return parsed;
  return fallback;
}

export function resolveSchedulerWindow(): SchedulerWindow {
  const startHour = parseHour(process.env.BACKGROUND_INGEST_WINDOW_START, 0);
  const endHour = parseHour(process.env.BACKGROUND_INGEST_WINDOW_END, 6);
  return { startHour, endHour };
}

export function isWithinSchedulerWindow(now: Date, window: SchedulerWindow): boolean {
  const { startHour, endHour } = window;
  const hour = now.getHours();
  if (startHour === endHour) return true; // window covers full day
  if (startHour < endHour) return hour >= startHour && hour < endHour;
  // Wrap-around window (e.g., 22 -> 3)
  return hour >= startHour || hour < endHour;
}

let initialized = false;

export function registerSchedulers(): void {
  if (initialized) return;

  const window = resolveSchedulerWindow();
  scheduleUnresolvedArtistJob(window);
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
