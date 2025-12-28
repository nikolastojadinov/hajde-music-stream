// backend/src/jobs/postBatch.ts
// FULL REWRITE — postBatch pulls playlistTargets FROM run job payload (same day + slot)

import supabase from '../services/supabaseClient';
import {
  ingestDiscoveredPlaylistTracks,
  PlaylistIngestTarget,
} from '../services/postBatchPlaylistTrackIngest';
import { RefreshJobRow } from '../types/jobs';

const TIMEZONE = 'Europe/Budapest';
const MIX_PREFIX = 'RD';
const CHANNEL_PREFIX = 'UC';

/* -------------------------------------------------------------------------- */
/* utils                                                                      */
/* -------------------------------------------------------------------------- */

function normalizeString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function isMixPlaylist(externalId: string): boolean {
  return externalId.startsWith(MIX_PREFIX);
}

function isChannelId(externalId: string): boolean {
  return externalId.startsWith(CHANNEL_PREFIX);
}

function dedupeTargets(
  rawTargets: PlaylistIngestTarget[]
): PlaylistIngestTarget[] {
  const map = new Map<string, PlaylistIngestTarget>();

  for (const raw of rawTargets) {
    const playlist_id = normalizeString(raw.playlist_id);
    const external_playlist_id = normalizeString(raw.external_playlist_id);

    if (!playlist_id || !external_playlist_id) continue;
    if (isMixPlaylist(external_playlist_id)) continue;
    if (isChannelId(external_playlist_id)) continue;

    if (!map.has(playlist_id)) {
      map.set(playlist_id, { playlist_id, external_playlist_id });
    }
  }

  return Array.from(map.values());
}

/* -------------------------------------------------------------------------- */
/* load targets from RUN job                                                   */
/* -------------------------------------------------------------------------- */

async function loadTargetsFromRunJob(
  dayKey: string,
  slotIndex: number
): Promise<PlaylistIngestTarget[]> {
  const { data, error } = await supabase
    .from('refresh_jobs')
    .select('payload')
    .eq('type', 'run')
    .eq('day_key', dayKey)
    .eq('slot_index', slotIndex)
    .eq('status', 'done')
    .limit(1)
    .maybeSingle();

  if (error || !data?.payload) {
    console.error('[postBatch] Failed to load run job payload', error);
    return [];
  }

  const rawTargets = Array.isArray((data.payload as any)?.playlistTargets)
    ? (data.payload as any).playlistTargets
    : [];

  return dedupeTargets(
    rawTargets.map((t: any) => ({
      playlist_id: normalizeString(t.playlist_id),
      external_playlist_id: normalizeString(t.external_playlist_id),
    }))
  );
}

/* -------------------------------------------------------------------------- */
/* finalize                                                                   */
/* -------------------------------------------------------------------------- */

async function finalizeJob(
  jobId: string,
  payload: Record<string, unknown>
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
/* main                                                                       */
/* -------------------------------------------------------------------------- */

export async function executePostBatchJob(
  job: RefreshJobRow
): Promise<void> {
  console.log('[postBatch] Starting', {
    jobId: job.id,
    day: job.day_key,
    slot: job.slot_index,
  });

  try {
    const targets = await loadTargetsFromRunJob(
      job.day_key,
      job.slot_index
    );

    if (targets.length === 0) {
      await finalizeJob(job.id, {
        timezone: TIMEZONE,
        targets_requested: 0,
        reason: 'no playlistTargets found in run job payload',
      });
      return;
    }

    const ingest = await ingestDiscoveredPlaylistTracks(targets);

    await finalizeJob(job.id, {
      timezone: TIMEZONE,
      targets_requested: targets.length,
      ingest,
    });

    console.log('[postBatch] Completed', {
      targets: targets.length,
      ingest,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error('[postBatch] Failed', message);

    await finalizeJob(job.id, { error: message });
  }
}
