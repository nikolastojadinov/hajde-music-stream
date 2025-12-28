// backend/src/jobs/postBatch.ts
// FULL REWRITE — postBatch is a pure executor (NO detection, NO deletes, NO heuristics)

import supabase from '../services/supabaseClient';
import {
  ingestDiscoveredPlaylistTracks,
  PlaylistIngestTarget,
} from '../services/postBatchPlaylistTrackIngest';
import { RefreshJobRow } from '../types/jobs';

const TIMEZONE = 'Europe/Budapest';
const MIX_PREFIX = 'RD';

/* -------------------------------------------------------------------------- */
/* utils                                                                      */
/* -------------------------------------------------------------------------- */

function normalizeString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function isMixPlaylist(externalId: string | null | undefined): boolean {
  return Boolean(externalId && externalId.startsWith(MIX_PREFIX));
}

function dedupeTargets(
  rawTargets: PlaylistIngestTarget[]
): PlaylistIngestTarget[] {
  const map = new Map<string, PlaylistIngestTarget>();

  for (const raw of Array.isArray(rawTargets) ? rawTargets : []) {
    const playlist_id = normalizeString((raw as any)?.playlist_id);
    const external_playlist_id = normalizeString(
      (raw as any)?.external_playlist_id
    );

    if (!playlist_id || !external_playlist_id) continue;
    if (isMixPlaylist(external_playlist_id)) continue;

    if (!map.has(playlist_id)) {
      map.set(playlist_id, { playlist_id, external_playlist_id });
    }
  }

  return Array.from(map.values());
}

/* -------------------------------------------------------------------------- */
/* payload handling                                                           */
/* -------------------------------------------------------------------------- */

function targetsFromPayload(
  payload: Record<string, unknown> | null
): PlaylistIngestTarget[] {
  if (!payload) return [];

  const list =
    (payload as any)?.playlistTargets ||
    (payload as any)?.playlistIds ||
    [];

  if (!Array.isArray(list)) return [];

  return dedupeTargets(
    list.map((entry: any) => ({
      playlist_id: normalizeString(entry?.playlist_id || entry?.id),
      external_playlist_id: normalizeString(
        entry?.external_playlist_id ||
          entry?.externalId ||
          entry?.external_id
      ),
    }))
  );
}

/* -------------------------------------------------------------------------- */
/* job finalize                                                               */
/* -------------------------------------------------------------------------- */

async function finalizeJob(
  jobId: string,
  payload: Record<string, unknown>
): Promise<void> {
  if (!supabase) return;

  const { error } = await supabase
    .from('refresh_jobs')
    .update({
      status: 'done',
      payload,
      updated_at: new Date().toISOString(),
    })
    .eq('id', jobId);

  if (error) {
    console.error('[postBatch] failed to finalize job', {
      jobId,
      error: error.message,
    });
  }
}

/* -------------------------------------------------------------------------- */
/* main executor                                                              */
/* -------------------------------------------------------------------------- */

export async function executePostBatchJob(
  job: RefreshJobRow
): Promise<void> {
  console.log('[postBatch] Starting job', {
    jobId: job.id,
    slot: job.slot_index,
    scheduledAt: job.scheduled_at,
  });

  if (!supabase) {
    await finalizeJob(job.id, {
      error: 'Supabase client unavailable',
    });
    return;
  }

  try {
    const targets = targetsFromPayload(job.payload);

    // Nothing to do — this is VALID and EXPECTED
    if (targets.length === 0) {
      console.log('[postBatch] No targets provided — skipping ingest', {
        jobId: job.id,
      });

      await finalizeJob(job.id, {
        timezone: TIMEZONE,
        targets_requested: 0,
        reason: 'no playlistTargets in payload',
      });
      return;
    }

    const ingestResult =
      await ingestDiscoveredPlaylistTracks(targets);

    await finalizeJob(job.id, {
      timezone: TIMEZONE,
      targets_requested: targets.length,
      ingest: ingestResult,
    });

    console.log('[postBatch] Job completed', {
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
