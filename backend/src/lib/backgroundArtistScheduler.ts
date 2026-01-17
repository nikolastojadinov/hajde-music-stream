import cron from 'node-cron';

import env from '../environments';
import { claimNextArtistForIngest, getArtistCompletionSnapshot, type ArtistCompletionSnapshot } from './db/artistQueries';
import { runFullArtistIngest } from '../services/fullArtistIngest';

const CRON_EXPRESSION = '*/5 * * * *';
const ACTIVE_WINDOW_START = 0; // 00:00 inclusive
const ACTIVE_WINDOW_END = 5;   // 05:00 exclusive

let scheduled = false;
let running = false;

function inActiveWindow(now: Date): boolean {
  const hour = now.getHours();
  return hour >= ACTIVE_WINDOW_START && hour < ACTIVE_WINDOW_END;
}

function logSummary(label: string, snapshot: ArtistCompletionSnapshot | null): void {
  if (!snapshot) {
    console.log(`[BackgroundArtistIngest] ${label}`, { state: 'missing' });
    return;
  }

  console.log(`[BackgroundArtistIngest] ${label}`, {
    artist_key: snapshot.artistKey,
    browse_id: snapshot.browseId,
    total_albums: snapshot.totalAlbums,
    complete_albums: snapshot.completeAlbums,
    partial_albums: snapshot.partialAlbums,
    unknown_albums: snapshot.unknownAlbums,
    expected_tracks: snapshot.expectedTracks,
    actual_tracks: snapshot.actualTracks,
    completion_percent: snapshot.completionPercent,
  });
}

async function runBackgroundIngestOnce(): Promise<void> {
  const start = Date.now();
  const now = new Date();

  if (!inActiveWindow(now)) {
    console.log('[BackgroundArtistIngest] Skipped: outside active window', { hour: now.getHours() });
    return;
  }

  const candidate = await claimNextArtistForIngest();
  if (!candidate) {
    console.log('[BackgroundArtistIngest] No eligible artist found');
    return;
  }

  logSummary('Selected artist', candidate);

  try {
    await runFullArtistIngest({
      artistKey: candidate.artistKey,
      browseId: candidate.browseId,
      source: 'background',
      force: false,
    });
  } catch (err: any) {
    console.error('[BackgroundArtistIngest] Ingest failed', {
      artist_key: candidate.artistKey,
      browse_id: candidate.browseId,
      message: err?.message || String(err),
      duration_ms: Date.now() - start,
    });
    return;
  }

  const after = await getArtistCompletionSnapshot(candidate.artistKey);
  logSummary('Completion after ingest', after);

  console.log('[BackgroundArtistIngest] Completed run', {
    artist_key: candidate.artistKey,
    browse_id: candidate.browseId,
    duration_ms: Date.now() - start,
  });
}

export function scheduleBackgroundArtistJob(): void {
  if (!env.enable_run_jobs) {
    console.log('[BackgroundArtistIngest] Scheduling disabled via ENABLE_RUN_JOBS=false');
    return;
  }

  if (scheduled) return;

  cron.schedule(CRON_EXPRESSION, async () => {
    if (running) {
      console.log('[BackgroundArtistIngest] Skipping run because previous job is still running');
      return;
    }

    running = true;
    try {
      await runBackgroundIngestOnce();
    } catch (err: any) {
      console.error('[BackgroundArtistIngest] Unexpected failure', err?.message || err);
    } finally {
      running = false;
    }
  });

  scheduled = true;
  console.log('[BackgroundArtistIngest] Cron scheduled every 5 minutes between 00:00-05:00 (server time)');
}
