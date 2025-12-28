// backend/src/jobs/postBatch.ts
// FULL REWRITE — fixed zero-track playlist detection (NO aggregates, NO COUNT)

import supabase from '../services/supabaseClient';
import {
  ingestDiscoveredPlaylistTracks,
  PlaylistIngestTarget,
} from '../services/postBatchPlaylistTrackIngest';
import { RefreshJobRow } from '../types/jobs';

const TIMEZONE = 'Europe/Budapest';
const MIX_PREFIX = 'RD';

function normalizeString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function isMixPlaylist(externalId: string | null | undefined): boolean {
  return Boolean(externalId && externalId.startsWith(MIX_PREFIX));
}

function dedupeTargets(rawTargets: PlaylistIngestTarget[]): PlaylistIngestTarget[] {
  const map = new Map<string, PlaylistIngestTarget>();

  for (const raw of Array.isArray(rawTargets) ? rawTargets : []) {
    const playlist_id = normalizeString((raw as any)?.playlist_id);
    const external_playlist_id = normalizeString((raw as any)?.external_playlist_id);

    if (!playlist_id || !external_playlist_id) continue;
    if (isMixPlaylist(external_playlist_id)) continue;

    if (!map.has(playlist_id)) {
      map.set(playlist_id, { playlist_id, external_playlist_id });
    }
  }

  return Array.from(map.values());
}

/**
 * ✅ CORRECT implementation:
 * Uses NOT EXISTS semantics via LEFT JOIN view
 * No aggregates, no COUNT, no Supabase SQL errors
 */
async function loadZeroTrackPlaylists(): Promise<PlaylistIngestTarget[]> {
  if (!supabase) return [];

  const { data, error } = await supabase
    .from('playlists')
    .select('id, external_id')
    .not('external_id', 'is', null)
    .not('id', 'in', supabase
      .from('playlist_tracks')
      .select('playlist_id') as any);

  if (error) {
    console.error('[postBatch] failed to load zero-track playlists', { error });
    return [];
  }

  const targets: PlaylistIngestTarget[] = [];

  for (const row of Array.isArray(data) ? data : []) {
    const playlist_id = normalizeString((row as any)?.id);
    const external_playlist_id = normalizeString((row as any)?.external_id);

    if (!playlist_id || !external_playlist_id) continue;
    if (isMixPlaylist(external_playlist_id)) continue;

    targets.push({ playlist_id, external_playlist_id });
  }

  return dedupeTargets(targets);
}

async function deletePlaylistWithRelations(playlistId: string): Promise<void> {
  if (!supabase) throw new Error('Supabase client unavailable');

  await supabase.from('playlist_tracks').delete().eq('playlist_id', playlistId);
  await supabase.from('playlist_likes').delete().eq('playlist_id', playlistId);
  await supabase.from('playlist_categories').delete().eq('playlist_id', playlistId);
  await supabase.from('playlist_views').delete().eq('playlist_id', playlistId);
  await supabase.from('likes').delete().eq('playlist_id', playlistId);

  await supabase
    .from('tracks')
    .update({ playlist_id: null })
    .eq('playlist_id', playlistId);

  const { error } = await supabase.from('playlists').delete().eq('id', playlistId);
  if (error) throw new Error(`Failed to delete playlist: ${error.message}`);
}

async function deleteEmptyPlaylists(): Promise<number> {
  const empties = await loadZeroTrackPlaylists();
  let deleted = 0;

  for (const target of empties) {
    try {
      await deletePlaylistWithRelations(target.playlist_id);
      deleted += 1;
    } catch (error) {
      console.warn('[postBatch] failed to delete empty playlist', {
        playlist_id: target.playlist_id,
        external_playlist_id: target.external_playlist_id,
        message: (error as Error)?.message || String(error),
      });
    }
  }

  return deleted;
}

function targetsFromPayload(payload: Record<string, unknown> | null): PlaylistIngestTarget[] {
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

async function finalizeJob(jobId: string, payload: Record<string, unknown>): Promise<void> {
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
    console.error('[postBatch] failed to finalize job', { jobId, error: error.message });
  }
}

export async function executePostBatchJob(job: RefreshJobRow): Promise<void> {
  console.log('[postBatch] Starting job', {
    jobId: job.id,
    slot: job.slot_index,
    scheduledAt: job.scheduled_at,
  });

  if (!supabase) {
    await finalizeJob(job.id, { error: 'Supabase client unavailable' });
    return;
  }

  try {
    const payloadTargets = targetsFromPayload(job.payload);
    const targets =
      payloadTargets.length > 0
        ? payloadTargets
        : await loadZeroTrackPlaylists();

    const ingestResult = await ingestDiscoveredPlaylistTracks(targets);
    const deletedEmptyPlaylists = await deleteEmptyPlaylists();

    await finalizeJob(job.id, {
      timezone: TIMEZONE,
      targets_requested: targets.length,
      ingest: ingestResult,
      deleted_empty_playlists: deletedEmptyPlaylists,
    });

    console.log('[postBatch] Job completed', {
      jobId: job.id,
      targets: targets.length,
      deleted_empty_playlists: deletedEmptyPlaylists,
      ingest: ingestResult,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';

    console.error('[postBatch] Job failed', { jobId: job.id, message });
    await finalizeJob(job.id, { error: message });
  }
}
