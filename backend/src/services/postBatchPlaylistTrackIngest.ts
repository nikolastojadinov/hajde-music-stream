import { youtubeBatchFetchPlaylists } from "./youtubeBatchFetchPlaylists";

const LOG_PREFIX = "[postBatchPlaylistTrackIngest]";
const MIX_PREFIX = "RD";

export type PlaylistIngestTarget = {
  playlist_id: string;
  external_playlist_id: string;
};

export type PostBatchIngestResult = {
  requested: number;
  queued: number;
  playlists_processed: number;
  tracks_ingested: number;
};

function normalizeString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function isMixPlaylist(externalId: string): boolean {
  return externalId.startsWith(MIX_PREFIX);
}

function dedupeTargets(rawTargets: PlaylistIngestTarget[]): PlaylistIngestTarget[] {
  const byPlaylistId = new Map<string, PlaylistIngestTarget>();

  for (const raw of Array.isArray(rawTargets) ? rawTargets : []) {
    const playlist_id = normalizeString((raw as any)?.playlist_id);
    const external_playlist_id = normalizeString((raw as any)?.external_playlist_id);
    if (!playlist_id || !external_playlist_id) continue;
    if (isMixPlaylist(external_playlist_id)) continue;
    if (!byPlaylistId.has(playlist_id)) {
      byPlaylistId.set(playlist_id, { playlist_id, external_playlist_id });
    }
  }

  return Array.from(byPlaylistId.values());
}

export async function ingestDiscoveredPlaylistTracks(
  targets: PlaylistIngestTarget[],
  options: { maxTotalTracks?: number } = {}
): Promise<PostBatchIngestResult> {
  const requested = Array.isArray(targets) ? targets.length : 0;
  const sanitized = dedupeTargets(targets);

  if (sanitized.length === 0) {
    console.info(`${LOG_PREFIX} no valid targets`, { requested });
    return { requested, queued: 0, playlists_processed: 0, tracks_ingested: 0 };
  }

  const batchResult = await youtubeBatchFetchPlaylists(sanitized, {
    max_total_tracks: options.maxTotalTracks,
  });

  const result = {
    requested,
    queued: sanitized.length,
    playlists_processed: batchResult.playlists_processed,
    tracks_ingested: batchResult.tracks_ingested,
  };

  console.info(`${LOG_PREFIX} DONE`, result);
  return result;
}
