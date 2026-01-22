import cron from 'node-cron';

import env from '../environments';
import { browseArtistById, musicSearch, type MusicSearchArtist, type MusicSearchResults } from '../services/youtubeMusicClient';
import { runFullArtistIngest } from '../services/fullArtistIngest';
import { ensureArtistDescriptionForNightly } from '../services/nightlyArtistIngest';
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
};

const JOB_LOG_CONTEXT = '[NightlyArtistIngest]';
const DEFAULT_CONFIG: JobConfig = {
  cronExpression: '*/3 * * * *',
  window: { startHour: 0, endHour: 5 },
};

let scheduled = false;
let running = false;

function normalize(value: string | null | undefined): string {
  return typeof value === 'string' ? value.trim() : '';
}

function isWithinSchedulerWindow(now: Date, window: SchedulerWindow): boolean {
  const { startHour, endHour } = window;
  const hour = now.getHours();
  if (startHour === endHour) return true;
  if (startHour < endHour) return hour >= startHour && hour < endHour;
  return hour >= startHour || hour < endHour;
}

function selectHeroArtist(results: MusicSearchResults): MusicSearchArtist | null {
  const ordered = Array.isArray(results.orderedItems) ? results.orderedItems : [];
  for (const item of ordered) {
    if (item.type !== 'artist') continue;
    const artist = item.data as MusicSearchArtist;
    if (artist && artist.isOfficial) return artist;
  }
  return null;
}

async function processCandidate(candidate: UnresolvedArtistCandidate): Promise<void> {
  await markResolveAttempt(candidate.artistKey);

  const queries = Array.from(
    new Set([
      candidate.displayName || '',
      candidate.normalizedName || '',
      candidate.artistKey,
    ].filter(Boolean)),
  );

  let hero: MusicSearchArtist | null = null;
  let heroBrowseId: string | null = null;
  let canonicalBrowseId: string | null = null;

  for (const q of queries) {
    try {
      const results = await musicSearch(q);
      hero = selectHeroArtist(results);
      if (hero && hero.id) {
        heroBrowseId = hero.id;
        break;
      }
    } catch (err) {
      console.error(`${JOB_LOG_CONTEXT} search_failed`, {
        artist_key: candidate.artistKey,
        normalized_name: candidate.normalizedName,
        query: q,
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }

  if (!hero || !heroBrowseId) {
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

  try {
    const browse = await browseArtistById(heroBrowseId);
    const parsedChannelId = normalize(browse?.artist?.channelId);
    canonicalBrowseId = parsedChannelId || heroBrowseId;
  } catch (err: any) {
    console.error(`${JOB_LOG_CONTEXT} browse_resolution_failed`, {
      artist_key: candidate.artistKey,
      normalized_name: candidate.normalizedName,
      youtube_channel_id: heroBrowseId,
      message: err?.message || String(err),
    });
  }

  const ingestBrowseId = canonicalBrowseId || heroBrowseId;

  console.info(`${JOB_LOG_CONTEXT} hero_artist_selected`, {
    artist_key: candidate.artistKey,
    normalized_name: candidate.normalizedName,
    hero_name: hero.name,
    youtube_channel_id: ingestBrowseId,
  });

  console.info(`${JOB_LOG_CONTEXT} resolution_result`, {
    artist_key: candidate.artistKey,
    normalized_name: candidate.normalizedName,
    resolution_status: 'resolved',
    youtube_channel_id: ingestBrowseId,
    ingest_started: true,
    ingest_skipped: false,
  });

  await persistArtistChannelId({
    artistKey: candidate.artistKey,
    youtubeChannelId: ingestBrowseId,
    displayName: candidate.displayName || candidate.normalizedName,
  });

  try {
    await ensureArtistDescriptionForNightly({
      artistKey: candidate.artistKey,
      browseId: ingestBrowseId,
      logPrefix: JOB_LOG_CONTEXT,
    });
  } catch (err: any) {
    console.error(`${JOB_LOG_CONTEXT} artist_description_write_failed`, {
      artist_key: candidate.artistKey,
      normalized_name: candidate.normalizedName,
      youtube_channel_id: ingestBrowseId,
      message: err?.message || String(err),
    });
  }

  try {
    await runFullArtistIngest({
      artistKey: candidate.artistKey,
      browseId: ingestBrowseId,
      source: 'background',
      force: false,
    });

    console.info(`${JOB_LOG_CONTEXT} ingest_completed`, {
      artist_key: candidate.artistKey,
      normalized_name: candidate.normalizedName,
      youtube_channel_id: heroBrowseId,
      ingest_completed: true,
    });
  } catch (err: any) {
    console.error(`${JOB_LOG_CONTEXT} ingest_failed`, {
      artist_key: candidate.artistKey,
      normalized_name: candidate.normalizedName,
      youtube_channel_id: heroBrowseId,
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

  try {
    const candidate = await claimNextUnresolvedArtist();
    if (!candidate) {
      console.log(`${JOB_LOG_CONTEXT} no_unresolved_artists`);
      return;
    }

    console.info(`${JOB_LOG_CONTEXT} resolution_started`, {
      artist_key: candidate.artistKey,
      normalized_name: candidate.normalizedName,
    });

    await processCandidate(candidate);

    console.log(`${JOB_LOG_CONTEXT} run_complete`, {
      processed: 1,
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
