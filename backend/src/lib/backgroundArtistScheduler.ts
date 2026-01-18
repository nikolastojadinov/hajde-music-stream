import cron from 'node-cron';

import env from '../environments';
import { musicSearch, type MusicSearchArtist } from '../services/youtubeMusicClient';
import { runFullArtistIngest } from '../services/fullArtistIngest';
import {
  claimNextUnresolvedArtist,
  markResolveAttempt,
  persistArtistChannelId,
  releaseUnresolvedArtistLock,
  tryAcquireUnresolvedArtistLock,
  type UnresolvedArtistCandidate,
} from './db/artistQueries';

export type SchedulerWindow = {
  startHour: number;
  endHour: number;
};

type JobConfig = {
  cronExpression: string;
  window: SchedulerWindow;
  batchSize: number;
};

const JOB_LOG_CONTEXT = '[NightlyArtistIngest]';
const DEFAULT_CONFIG: JobConfig = {
  cronExpression: '*/5 * * * *',
  window: { startHour: 0, endHour: 5 },
  batchSize: 3,
};

let scheduled = false;
let running = false;

function isWithinSchedulerWindow(now: Date, window: SchedulerWindow): boolean {
  const { startHour, endHour } = window;
  const hour = now.getHours();
  if (startHour === endHour) return true;
  if (startHour < endHour) return hour >= startHour && hour < endHour;
  return hour >= startHour || hour < endHour;
}

function normalizeLoose(value: string | null | undefined): string {
  return typeof value === 'string' ? value.toLowerCase().replace(/\s+/g, ' ').trim() : '';
}

function looksLikeBrowseId(value: string): boolean {
  const v = normalizeLoose(value).replace(/\s+/g, '');
  if (!v) return false;
  return /^(OLAK|PL|VL|RD|MP|UU|LL|UC|OL|RV)[A-Za-z0-9_-]+$/.test(v);
}

function pickBestArtistMatch(artists: MusicSearchArtist[], query: string): MusicSearchArtist | null {
  const target = normalizeLoose(query);
  if (!target) return null;

  const scored = artists
    .map((artist) => {
      const nameNorm = normalizeLoose(artist.name);
      const pageType = normalizeLoose((artist as any).pageType || '');
      let score = 0;
      if (nameNorm === target) score += 200;
      if (nameNorm.includes(target) || target.includes(nameNorm)) score += 60;
      if (pageType.includes('artist')) score += 40;
      if (artist.isOfficial) score += 30;
      if (nameNorm.includes('tribute') || nameNorm.includes('cover')) score -= 100;
      return { artist, score };
    })
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score);

  return scored.length ? scored[0].artist : null;
}

async function resolveBrowseId(candidate: UnresolvedArtistCandidate): Promise<string | null> {
  const queries = Array.from(
    new Set([
      candidate.displayName || '',
      candidate.normalizedName || '',
      candidate.artistKey,
    ].filter(Boolean)),
  );

  for (const q of queries) {
    try {
      const results = await musicSearch(q);
      const artists = Array.isArray(results.artists) ? results.artists : [];
      const best = pickBestArtistMatch(artists, q);
      if (best && looksLikeBrowseId(best.id)) return best.id;
    } catch (err) {
      console.error(`${JOB_LOG_CONTEXT} search_failed`, {
        artist_key: candidate.artistKey,
        normalized_name: candidate.normalizedName,
        query: q,
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return null;
}

async function processCandidate(candidate: UnresolvedArtistCandidate): Promise<void> {
  await markResolveAttempt(candidate.artistKey);

  const browseId = await resolveBrowseId(candidate);
  if (!browseId) {
    console.info(`${JOB_LOG_CONTEXT} resolution_result`, {
      artist_key: candidate.artistKey,
      normalized_name: candidate.normalizedName,
      resolution_status: 'unresolved',
      youtube_channel_id: null,
      ingest_started: false,
      ingest_skipped: true,
    });
    return;
  }

  console.info(`${JOB_LOG_CONTEXT} resolution_result`, {
    artist_key: candidate.artistKey,
    normalized_name: candidate.normalizedName,
    resolution_status: 'resolved',
    youtube_channel_id: browseId,
    ingest_started: true,
    ingest_skipped: false,
  });

  await persistArtistChannelId({
    artistKey: candidate.artistKey,
    youtubeChannelId: browseId,
    displayName: candidate.displayName || candidate.normalizedName,
  });

  try {
    await runFullArtistIngest({
      artistKey: candidate.artistKey,
      browseId,
      source: 'background',
      force: false,
    });

    console.info(`${JOB_LOG_CONTEXT} ingest_completed`, {
      artist_key: candidate.artistKey,
      normalized_name: candidate.normalizedName,
      youtube_channel_id: browseId,
      ingest_completed: true,
    });
  } catch (err: any) {
    console.error(`${JOB_LOG_CONTEXT} ingest_failed`, {
      artist_key: candidate.artistKey,
      normalized_name: candidate.normalizedName,
      youtube_channel_id: browseId,
      ingest_failed: true,
      message: err?.message || String(err),
    });
  }
}

async function runNightlyArtistIngestOnce(config: JobConfig): Promise<void> {
  const startedAtMs = Date.now();
  const now = new Date();

  if (!isWithinSchedulerWindow(now, config.window)) {
    console.log(`${JOB_LOG_CONTEXT} skipped_outside_window`, { hour: now.getHours() });
    return;
  }

  console.log(`${JOB_LOG_CONTEXT} run_start`, { hour: now.getHours() });

  const lockAcquired = await tryAcquireUnresolvedArtistLock();
  if (!lockAcquired) {
    console.log(`${JOB_LOG_CONTEXT} lock_not_acquired`);
    return;
  }

  let processed = 0;

  try {
    while (processed < config.batchSize) {
      const candidate = await claimNextUnresolvedArtist();
      if (!candidate) {
        console.log(`${JOB_LOG_CONTEXT} no_unresolved_artists`);
        break;
      }

      console.info(`${JOB_LOG_CONTEXT} resolution_started`, {
        artist_key: candidate.artistKey,
        normalized_name: candidate.normalizedName,
      });

      await processCandidate(candidate);
      processed += 1;
    }

    console.log(`${JOB_LOG_CONTEXT} run_complete`, {
      processed,
      duration_ms: Date.now() - startedAtMs,
    });
  } finally {
    await releaseUnresolvedArtistLock();
  }
}

export function scheduleUnresolvedArtistJob(window: SchedulerWindow): void {
  if (!env.enable_run_jobs) {
    console.log(`${JOB_LOG_CONTEXT} scheduling_disabled`);
    return;
  }
  if (scheduled) return;

  const config: JobConfig = { ...DEFAULT_CONFIG, window };

  cron.schedule(config.cronExpression, async () => {
    if (running) {
      console.log(`${JOB_LOG_CONTEXT} skip_concurrent_run`);
      return;
    }

    running = true;
    try {
      await runNightlyArtistIngestOnce(config);
    } catch (err: any) {
      console.error(`${JOB_LOG_CONTEXT} unexpected_failure`, err?.message || err);
    } finally {
      running = false;
    }
  });

  scheduled = true;
  console.log(`${JOB_LOG_CONTEXT} scheduled`, { cron: config.cronExpression, window_start: window.startHour, window_end: window.endHour });
}
