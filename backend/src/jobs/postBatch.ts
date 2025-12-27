import supabase from '../services/supabaseClient';
import { ingestDiscoveredPlaylistTracks, PlaylistIngestTarget } from '../services/postBatchPlaylistTrackIngest';

const TIMEZONE = 'Europe/Budapest';

export type JobStatus = 'pending' | 'running' | 'done' | 'error';
export type JobType = 'prepare' | 'run' | 'postbatch';

export type RefreshJobRow = {
  id: string;
  slot_index: number;
  type: JobType;
  scheduled_at: string;
  day_key: string;
  status: JobStatus;
  payload: Record<string, unknown> | null;
};

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
    if (!map.has(playlist_id)) map.set(playlist_id, { playlist_id, external_playlist_id });
  }

  return Array.from(map.values());
}

async function loadZeroTrackPlaylists(): Promise<PlaylistIngestTarget[]> {
  if (!supabase) return [];

  const { data, error } = await supabase
    .from('playlists')
    .select('id, external_id, playlist_tracks(count)')
    .not('external_id', 'is', null)
    .eq('playlist_tracks.count', 0);

  if (error) {
    console.error('[postBatch] failed to load zero-track playlists', { error });
    return [];
  }

  const targets: PlaylistIngestTarget[] = [];
  for (const row of (Array.isArray(data) ? data : []) as any[]) {
    const playlist_id = normalizeString(row?.id);
    const external_playlist_id = normalizeString(row?.external_id);
    if (!playlist_id || !external_playlist_id) continue;
    if (isMixPlaylist(external_playlist_id)) continue;
    targets.push({ playlist_id, external_playlist_id });
  }

  return dedupeTargets(targets);
}

async function deletePlaylistWithRelations(playlistId: string): Promise<void> {
  if (!supabase) throw new Error('Supabase client unavailable');

  const { error: ptError } = await supabase.from('playlist_tracks').delete().eq('playlist_id', playlistId);
  if (ptError) throw new Error(`Failed to delete playlist_tracks: ${ptError.message}`);

  const { error: plError } = await supabase.from('playlist_likes').delete().eq('playlist_id', playlistId);
  if (plError) throw new Error(`Failed to delete playlist_likes: ${plError.message}`);

  const { error: pcError } = await supabase.from('playlist_categories').delete().eq('playlist_id', playlistId);
  if (pcError) throw new Error(`Failed to delete playlist_categories: ${pcError.message}`);

  const { error: pvError } = await supabase.from('playlist_views').delete().eq('playlist_id', playlistId);
  if (pvError) throw new Error(`Failed to delete playlist_views: ${pvError.message}`);

  const { error: likesError } = await supabase.from('likes').delete().eq('playlist_id', playlistId);
  if (likesError) throw new Error(`Failed to delete likes: ${likesError.message}`);

  const { error: tracksUpdateError } = await supabase.from('tracks').update({ playlist_id: null }).eq('playlist_id', playlistId);
  if (tracksUpdateError) throw new Error(`Failed to detach tracks: ${tracksUpdateError.message}`);

  const { error: playlistError } = await supabase.from('playlists').delete().eq('id', playlistId);
  if (playlistError) throw new Error(`Failed to delete playlist: ${playlistError.message}`);
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
  const list = (payload as any)?.playlistTargets || (payload as any)?.playlistIds || [];
  if (!Array.isArray(list)) return [];

  return dedupeTargets(
    list.map((entry: any) => ({
      playlist_id: normalizeString(entry?.playlist_id || entry?.id),
      external_playlist_id: normalizeString(entry?.external_playlist_id || entry?.externalId || entry?.external_id),
    }))
  );
}

async function finalizeJob(jobId: string, payload: Record<string, unknown>): Promise<void> {
  if (!supabase) return;
  const { error } = await supabase.from('refresh_jobs').update({ status: 'done', payload }).eq('id', jobId);
  if (error) console.error('[postBatch] failed to finalize job', { jobId, error: error.message });
}

export async function executePostBatchJob(job: RefreshJobRow): Promise<void> {
  console.log('[postBatch] Starting job', { jobId: job.id, slot: job.slot_index, scheduledAt: job.scheduled_at });

  if (!supabase) {
    console.error('[postBatch] Supabase client unavailable');
    await finalizeJob(job.id, { error: 'Supabase client unavailable' });
    return;
  }

  try {
    const payloadTargets = targetsFromPayload(job.payload);
    const zeroTrackTargets = payloadTargets.length > 0 ? [] : await loadZeroTrackPlaylists();
    const targets = payloadTargets.length > 0 ? payloadTargets : zeroTrackTargets;

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
