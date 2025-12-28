// backend/src/jobs/postBatch.ts
// FINAL — postBatch strictly consumes RUN job payload

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

function isInvalidExternalId(externalId: string): boolean {
  return (
    externalId.startsWith(MIX_PREFIX) ||
    externalId.startsWith(CHANNEL_PREFIX)
  );
}

function dedupeTargets(
  rawTargets: PlaylistIngestTarget[]
): PlaylistIngestTarget[] {
  const map = new Map<string, PlaylistIngestTarget>();

  for (const raw of rawTargets) {
    const playlist_id = normalizeString(raw.playlist_id);
    const external_playlist_id = normalizeString(raw.external_playlist_id);

    if (!playlist_id || !external_playlist_id) continue;
    if (isInvalidExternalId(external_playlist_id)) continue;

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
  slotIndex: number
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
          entry.external_id
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
  job: RefreshJobRow
): Promise<void> {
  console.log('[postBatch] Starting job', {
    jobId: job.id,
    slot: job.slot_index,
    day_key: job.day_key,
  });

  try {
    const targets = await loadRunJobTargets(
      job.day_key,
      job.slot_index
    );

    if (targets.length === 0) {
      throw new Error('RUN job returned zero valid playlist targets');
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
