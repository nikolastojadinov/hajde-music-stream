import supabase from "./supabaseClient";
import { youtubeFetchPlaylistTracks } from "./youtubeFetchPlaylistTracks";

const LOG_PREFIX = "[youtubeBatchFetchPlaylists]";
const SELECT_CHUNK_SIZE = 200;

function normalizeString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function chunkArray<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

export type YoutubeBatchFetchPlaylistsItem = {
  playlist_id: string;
  external_playlist_id: string;
  max_tracks?: number;
  replace_existing?: boolean;
  artist_override?: string;
  artist_channel_id_override?: string;
};

export type YoutubeBatchFetchPlaylistsOptions = {
  // If provided, the batch will stop once this many tracks have been ingested.
  max_total_tracks?: number;
};

/**
 * Batch helper around youtubeFetchPlaylistTracks.
 *
 * Goals:
 * - Load stored ETags (best-effort) and pass `if_none_match` to reduce YouTube quota
 * - Provide a single entry-point to ingest many playlists
 * - Respect a max_total_tracks budget (when provided)
 */
export async function youtubeBatchFetchPlaylists(
  items: YoutubeBatchFetchPlaylistsItem[],
  options: YoutubeBatchFetchPlaylistsOptions = {}
): Promise<{ playlists_processed: number; tracks_ingested: number }> {
  if (!supabase) return { playlists_processed: 0, tracks_ingested: 0 };

  const normalized: YoutubeBatchFetchPlaylistsItem[] = [];
  for (const raw of Array.isArray(items) ? items : []) {
    const playlist_id = normalizeString((raw as any)?.playlist_id);
    const external_playlist_id = normalizeString((raw as any)?.external_playlist_id);
    if (!playlist_id || !external_playlist_id) continue;

    const max_tracks_raw = (raw as any)?.max_tracks;
    const max_tracks =
      typeof max_tracks_raw === "number" && Number.isFinite(max_tracks_raw)
        ? Math.max(0, Math.trunc(max_tracks_raw))
        : undefined;

    normalized.push({
      playlist_id,
      external_playlist_id,
      max_tracks,
      replace_existing: Boolean((raw as any)?.replace_existing),
      artist_override: normalizeString((raw as any)?.artist_override) || undefined,
      artist_channel_id_override: normalizeString((raw as any)?.artist_channel_id_override) || undefined,
    });
  }

  if (normalized.length === 0) return { playlists_processed: 0, tracks_ingested: 0 };

  // Best-effort: load last_etag for playlists so youtubeFetchPlaylistTracks can short-circuit with If-None-Match.
  const etagByPlaylistId = new Map<string, string>();
  try {
    for (const chunk of chunkArray(normalized.map((i) => i.playlist_id), SELECT_CHUNK_SIZE)) {
      const { data, error } = await supabase.from("playlists").select("id, last_etag").in("id", chunk as any);
      if (error) continue;
      for (const row of (Array.isArray(data) ? (data as any[]) : []) as any[]) {
        const id = normalizeString(row?.id);
        const etag = normalizeString(row?.last_etag);
        if (id && etag) etagByPlaylistId.set(id, etag);
      }
    }
  } catch {
    // ignore: schema may not include last_etag
  }

  let tracksIngested = 0;
  let playlistsProcessed = 0;
  const maxTotalRaw = options.max_total_tracks;
  const maxTotal =
    typeof maxTotalRaw === "number" && Number.isFinite(maxTotalRaw) ? Math.max(0, Math.trunc(maxTotalRaw)) : null;

  for (const item of normalized) {
    if (maxTotal !== null && tracksIngested >= maxTotal) break;

    const remaining = maxTotal !== null ? Math.max(0, maxTotal - tracksIngested) : null;
    const max_tracks =
      typeof item.max_tracks === "number"
        ? remaining !== null
          ? Math.min(item.max_tracks, remaining)
          : item.max_tracks
        : remaining ?? undefined;

    const if_none_match = etagByPlaylistId.get(item.playlist_id);

    const inserted = await youtubeFetchPlaylistTracks({
      playlist_id: item.playlist_id,
      external_playlist_id: item.external_playlist_id,
      max_tracks,
      replace_existing: item.replace_existing,
      if_none_match: if_none_match || undefined,
      artist_override: item.artist_override,
      artist_channel_id_override: item.artist_channel_id_override,
    });

    playlistsProcessed += 1;

    if (inserted === null) {
      console.warn(LOG_PREFIX, "playlist ingest failed", {
        playlist_id: item.playlist_id,
        external_playlist_id: item.external_playlist_id,
      });
      continue;
    }

    tracksIngested += inserted;
  }

  console.info(LOG_PREFIX, "DONE", { playlists_processed: playlistsProcessed, tracks_ingested: tracksIngested });
  return { playlists_processed: playlistsProcessed, tracks_ingested: tracksIngested };
}
