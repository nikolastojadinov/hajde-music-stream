import cron from 'node-cron';

import env from '../environments';
import { browseArtistById } from '../services/youtubeMusicClient';
import { runFullArtistIngest } from '../services/fullArtistIngest';
import { ensureArtistDescriptionForNightly } from '../services/nightlyArtistIngest';
import { createNightlyIngestReporter, type NightlyIngestReporter } from '../ingest/nightlyIngestRunner';
import {
  claimNextUnresolvedArtist,
  markResolveAttempt,
  persistArtistChannelId,
  releaseUnresolvedArtistLock,
  tryAcquireUnresolvedArtistLock,
  type UnresolvedArtistCandidate,
} from './db/artistQueries';
import { resolveArtistBrowseId } from './artistResolver';

const JOB_LOG_CONTEXT = '[NightlyArtistIngest]';
const SCHEDULER_TIMEZONE = process.env.TZ || 'UTC';
const CRON_EXPRESSION = '*/5 * * * *';

let scheduled = false;
let running = false;

function normalize(value: string | null | undefined): string {
  return typeof value === 'string' ? value.trim() : '';
}

function nowInSchedulerTimezone(): Date {
  // Force Date construction to the configured timezone; node-cron also uses this TZ when scheduling.
  return new Date(new Date().toLocaleString('en-US', { timeZone: SCHEDULER_TIMEZONE }));
}

async function processCandidate(candidate: UnresolvedArtistCandidate, reporter?: NightlyIngestReporter): Promise<void> {
  await markResolveAttempt(candidate.artistKey);

  const queries = Array.from(
    new Set([
      candidate.displayName || '',
      candidate.normalizedName || '',
      candidate.artistKey,
    ].filter(Boolean)),
  );

  let heroName: string | null = null;
  let heroBrowseId: string | null = null;
  let canonicalBrowseId: string | null = null;

  for (const q of queries) {
    try {
      const resolution = await resolveArtistBrowseId(q);
      if (resolution?.browseId) {
        heroBrowseId = resolution.browseId;
        heroName = resolution.title || heroName;
        break;
      }
    } catch (err) {
      console.error(`${JOB_LOG_CONTEXT} search_failed`, {
        artist_key: candidate.artistKey,
        normalized_name: candidate.normalizedName,
        query: q,
        message: err instanceof Error ? err.message : String(err),
      });
      reporter?.addWarning(`search_failed ${candidate.artistKey}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  if (!heroBrowseId) {
    console.info(`${JOB_LOG_CONTEXT} resolution_result`, {
      artist_key: candidate.artistKey,
      normalized_name: candidate.normalizedName,
      resolution_status: 'unresolved',
      youtube_channel_id: null,
      ingest_started: false,
      ingest_skipped: true,
    });
    reporter?.addWarning(`artist_unresolved ${candidate.artistKey}`);
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
    reporter?.addWarning(`browse_resolution_failed ${candidate.artistKey}: ${err?.message || 'unknown_error'}`);
  }

  const ingestBrowseId = canonicalBrowseId || heroBrowseId;

  console.info(`${JOB_LOG_CONTEXT} hero_artist_selected`, {
    artist_key: candidate.artistKey,
    normalized_name: candidate.normalizedName,
    hero_name: heroName,
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
    await runFullArtistIngest(
      {
        artistKey: candidate.artistKey,
        browseId: ingestBrowseId,
        source: 'background',
        force: false,
      },
      { reporter },
    );

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
    reporter?.addWarning(`ingest_failed ${candidate.artistKey}: ${err?.message || 'unknown_error'}`);
  }
}

async function runNightlyArtistIngestOnce(): Promise<void> {
  const now = nowInSchedulerTimezone();
  const reporter = createNightlyIngestReporter();
  const startedAtMs = Date.now();

  console.log(`${JOB_LOG_CONTEXT} run_start`, { hour: now.getHours(), mode: '24h', timezone: SCHEDULER_TIMEZONE });

  const lockAcquired = await tryAcquireUnresolvedArtistLock();
  if (!lockAcquired) {
    console.log(`${JOB_LOG_CONTEXT} lock_not_acquired`);
    reporter.addWarning('lock_not_acquired');
    reporter.markEnd();
    await reporter.persist();
    return;
  }

  try {
    const candidate = await claimNextUnresolvedArtist();
    if (!candidate) {
      console.log(`${JOB_LOG_CONTEXT} no_unresolved_artists`);
      reporter.addWarning('no_unresolved_artists');
      return;
    }

    console.info(`${JOB_LOG_CONTEXT} resolution_started`, {
      artist_key: candidate.artistKey,
      normalized_name: candidate.normalizedName,
    });

    await processCandidate(candidate, reporter);

    console.log(`${JOB_LOG_CONTEXT} run_complete`, {
      processed: 1,
      duration_ms: Date.now() - startedAtMs,
    });
  } finally {
    await releaseUnresolvedArtistLock();
    reporter.markEnd();
    await reporter.persist();
  }
}

export function scheduleUnresolvedArtistJob(): void {
  if (!env.enable_run_jobs) {
    console.log(`${JOB_LOG_CONTEXT} scheduling_disabled`);
    return;
  }
  if (scheduled) return;

  cron.schedule(CRON_EXPRESSION, async () => {
    if (running) {
      console.log(`${JOB_LOG_CONTEXT} skip_concurrent_run`);
      return;
    }

    running = true;
    try {
      await runNightlyArtistIngestOnce();
    } catch (err: any) {
      console.error(`${JOB_LOG_CONTEXT} unexpected_failure`, err?.message || err);
    } finally {
      running = false;
    }
  }, { timezone: SCHEDULER_TIMEZONE });

  scheduled = true;
  console.log(`${JOB_LOG_CONTEXT} scheduled`, {
    cron: CRON_EXPRESSION,
    mode: '24h',
    timezone: SCHEDULER_TIMEZONE,
  });
}
