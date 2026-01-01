// backend/src/jobs/postBatch.ts
// FINAL — Lazy postBatch, mirrors first artist page open behavior
// Consumes ONLY runBatch playlistTargets for the same day/slot

import supabase from '../services/supabaseClient';
import {
  ingestDiscoveredPlaylistTracks,
  PlaylistIngestTarget,
} from '../services/postBatchPlaylistTrackIngest';
import { RefreshJobRow } from '../types/jobs';

const TIMEZONE = 'Europe/Budapest';
const MIX_PREFIX = 'RD';
const MAX_TRACKS_PER_PLAYLIST = 7;

/* -------------------------------------------------------------------------- */
/* utils                                                                      */
/* -------------------------------------------------------------------------- */

function normalizeString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function isMixPlaylist(externalId: string): boolean {
  return externalId.startsWith(MIX_PREFIX);
}

function dedupeTargets(
  rawTargets: PlaylistIngestTarget[],
): PlaylistIngestTarget[] {
  const map = new Map<string, PlaylistIngestTarget>();

  for (const raw of rawTargets) {
    const playlist_id = normalizeString(raw.playlist_id);
    const external_playlist_id = normalizeString(raw.external_playlist_id);

    if (!playlist_id || !external_playlist_id) continue;
    if (isMixPlaylist(external_playlist_id)) continue;

    if (!map.has(playlist_id)) {
      map.set(playlist_id, { playlist_id, external_playlist_id });
    }
  }

  return Array.from(map.values());
}

/* -------------------------------------------------------------------------- */
/* load RUN job payload                                                       */
/* -------------------------------------------------------------------------- */

async function loadRunJobTargets(
  dayKey: string,
  slotIndex: number,
): Promise<PlaylistIngestTarget[]> {
  const { data, error } = await supabase
    .from('refresh_jobs')
    .select('payload')
    .eq('type', 'run')
    .eq('status', 'done')
    .eq('day_key', dayKey)
    .eq('slot_index', slotIndex)
    .single();

  if (error || !data) {
    throw new Error('RUN job not found or not completed');
  }

  const list = (data.payload as any)?.playlistTargets;

  if (!Array.isArray(list)) {
    throw new Error('RUN payload missing playlistTargets');
  }

  return dedupeTargets(
    list.map((entry: any) => ({
      playlist_id: normalizeString(entry.playlist_id || entry.id),
      external_playlist_id: normalizeString(
        entry.external_playlist_id ||
          entry.externalId ||
          entry.external_id,
      ),
    })),
  );
}

/* -------------------------------------------------------------------------- */
/* job finalize                                                               */
/* -------------------------------------------------------------------------- */

async function finalizeJob(
  jobId: string,
  payload: Record<string, unknown>,
): Promise<void> {
  await supabase
    .from('refresh_jobs')
    .update({
      status: 'done',
      payload,
      updated_at: new Date().toISOString(),
    })
    .eq('id', jobId);
}

/* -------------------------------------------------------------------------- */
/* main executor                                                              */
/* -------------------------------------------------------------------------- */

export async function executePostBatchJob(
  job: RefreshJobRow,
): Promise<void> {
  console.log('[postBatch] Starting lazy job', {
    jobId: job.id,
    slot: job.slot_index,
    day_key: job.day_key,
  });

  try {
    const targets = await loadRunJobTargets(
      job.day_key,
      job.slot_index,
    );

    if (targets.length === 0) {
      console.warn('[postBatch] No playlist targets from runBatch');
      await finalizeJob(job.id, {
        timezone: TIMEZONE,
        targets_requested: 0,
        ingest: { skipped: true },
      });
      return;
    }

    // 🔥 LAZY INGEST — EXACTLY LIKE FIRST ARTIST PAGE OPEN
    const ingestResult = await ingestDiscoveredPlaylistTracks(
      targets,
      {
        max_tracks: MAX_TRACKS_PER_PLAYLIST,
        replace_existing: false,
        ingest_mode: 'lazy',
        source: 'postBatch',
      },
    );

    await finalizeJob(job.id, {
      timezone: TIMEZONE,
      targets_requested: targets.length,
      ingest: ingestResult,
      mode: 'lazy',
    });

    console.log('[postBatch] Job completed (lazy)', {
      jobId: job.id,
      targets: targets.length,
      ingest: ingestResult,
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : 'Unknown error';

    console.error('[postBatch] Job failed', {
      jobId: job.id,
      message,
    });

    await finalizeJob(job.id, { error: message });
  }
}
