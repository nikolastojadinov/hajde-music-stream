import supabase from "./supabaseClient";
import { youtubeSearchMixed } from "./youtubeClient";
import { upsertYoutubeChannelMapping } from "./artistResolver";
import { canonicalArtistName } from "../utils/artistKey";
import { youtubeFetchPlaylistTracks } from "./youtubeFetchPlaylistTracks";
import { isOlakPlaylistId } from "../utils/olak";

const LOG_PREFIX = "[IngestArtistFromYouTubeSearch]";
const INSERT_CHUNK_SIZE = 200;

function normalizeString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeNullableString(value: unknown): string | null {
  const s = normalizeString(value);
  return s ? s : null;
}

function chunkArray<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

export type IngestArtistFromYouTubeSearchInput = {
  artistName: string;
  // If provided, we store playlist rows under this channel id so /api/artist includes them.
  store_channel_id_override?: string;
  store_channel_title_override?: string;
  // Limit how many playlists from search we ingest.
  max_playlists?: number;
  // Limit total tracks ingested across playlists.
  max_tracks?: number;
};

export type IngestArtistFromYouTubeSearchResult = {
  playlists_ingested: number;
  tracks_ingested: number;
};

/**
 * Search-based ingestion to capture "regular" playlists and songs that don't belong to the official channelId.
 *
 * - One `youtube.search.list` (mixed) call
 * - Upserts lightweight playlist rows
 * - Ingests playlist tracks via playlistItems/videos
 *
 * Notes:
 * - We intentionally store ingested track rows under the provided artistName and optional channel override,
 *   so that /api/artist can render them immediately.
 */
export async function ingestArtistFromYouTubeSearch(
  input: IngestArtistFromYouTubeSearchInput
): Promise<IngestArtistFromYouTubeSearchResult | null> {
  try {
    if (!supabase) return null;

    const artistName = canonicalArtistName(normalizeString(input.artistName));
    if (!artistName) return null;

    const storeChannelId = normalizeNullableString(input.store_channel_id_override);
    const storeChannelTitle = normalizeNullableString(input.store_channel_title_override) || artistName;

    const mixed = await youtubeSearchMixed(artistName);

    // Cache channelId mappings (best-effort).
    for (const ch of Array.isArray(mixed.channels) ? mixed.channels : []) {
      const name = normalizeString((ch as any)?.title).toLowerCase();
      const youtube_channel_id = normalizeString((ch as any)?.channelId);
      if (!name || !youtube_channel_id) continue;
      try {
        await upsertYoutubeChannelMapping({ name, youtube_channel_id });
      } catch {
        // ignore
      }
    }

    // Upsert playlist rows and get ids back.
    const playlists = (Array.isArray(mixed.playlists) ? mixed.playlists : [])
      .map((p) => {
        const external_id = normalizeString((p as any)?.playlistId);
        const title = normalizeString((p as any)?.title);
        const channel_id_raw = normalizeNullableString((p as any)?.channelId);
        const channel_title_raw = normalizeNullableString((p as any)?.channelTitle);
        const cover_url = normalizeNullableString((p as any)?.thumbUrl);
        if (!external_id || !title) return null;
        if (isOlakPlaylistId(external_id)) return null;

        return {
          external_id,
          title,
          description: null,
          cover_url,
          channel_id: storeChannelId || channel_id_raw,
          channel_title: storeChannelTitle || channel_title_raw,
          item_count: null,
          sync_status: "fetched",
        };
      })
      .filter((x): x is NonNullable<typeof x> => Boolean(x));

    const maxPlaylistsRaw = input.max_playlists;
    const maxPlaylists = typeof maxPlaylistsRaw === "number" && Number.isFinite(maxPlaylistsRaw) ? Math.max(0, Math.trunc(maxPlaylistsRaw)) : null;

    const playlistsToUpsert = maxPlaylists !== null ? playlists.slice(0, maxPlaylists) : playlists;

    let persistedPlaylists: Array<{ id: string; external_id: string }> = [];
    if (playlistsToUpsert.length > 0) {
      const { data, error } = await supabase
        .from("playlists")
        .upsert(playlistsToUpsert as any, { onConflict: "external_id" })
        .select("id, external_id");

      if (error) {
        console.warn(LOG_PREFIX, "playlists upsert failed", { code: error.code, message: error.message });
        return null;
      }

      const rows = Array.isArray(data) ? (data as any[]) : [];
      persistedPlaylists = rows
        .map((r) => ({ id: normalizeString(r?.id), external_id: normalizeString(r?.external_id) }))
        .filter((r) => r.id && r.external_id);
    }

    // Also upsert lightweight video rows (best-effort) so search videos appear quickly.
    // This does not link them to playlists, but makes them renderable under artist-name matching.
    const videos = (Array.isArray(mixed.videos) ? mixed.videos : [])
      .map((v) => {
        const external_id = normalizeString((v as any)?.videoId);
        const title = normalizeString((v as any)?.title);
        const cover_url = normalizeNullableString((v as any)?.thumbUrl);
        if (!external_id || !title) return null;

        return {
          source: "youtube" as const,
          external_id,
          youtube_id: external_id,
          title,
          artist: artistName,
          cover_url,
          artist_channel_id: storeChannelId || normalizeNullableString((v as any)?.channelId),
          duration: null,
        };
      })
      .filter((x): x is NonNullable<typeof x> => Boolean(x));

    if (videos.length > 0) {
      for (const chunk of chunkArray(videos, INSERT_CHUNK_SIZE)) {
        try {
          await supabase.from("tracks").upsert(chunk as any, { onConflict: "external_id" });
        } catch {
          // ignore
        }
      }
    }

    // Ingest tracks from discovered playlists.
    let tracksIngested = 0;
    const maxTracksRaw = input.max_tracks;
    const maxTracks = typeof maxTracksRaw === "number" && Number.isFinite(maxTracksRaw) ? Math.max(0, Math.trunc(maxTracksRaw)) : null;

    for (const p of persistedPlaylists) {
      if (maxTracks !== null && tracksIngested >= maxTracks) break;

      const remaining = maxTracks !== null ? Math.max(0, maxTracks - tracksIngested) : null;
      const inserted = await youtubeFetchPlaylistTracks({
        playlist_id: p.id,
        external_playlist_id: p.external_id,
        max_tracks: remaining ?? undefined,
        artist_override: artistName,
        artist_channel_id_override: storeChannelId ?? undefined,
      });

      if (inserted === null) {
        console.warn(LOG_PREFIX, "playlist track ingest failed", {
          artistName,
          playlist_id: p.id,
          external_playlist_id: p.external_id,
        });
        continue;
      }

      tracksIngested += inserted;
    }

    console.info(LOG_PREFIX, "DONE", {
      artistName,
      playlists_ingested: persistedPlaylists.length,
      tracks_ingested: tracksIngested,
      store_channel_id_override: storeChannelId,
    });

    return {
      playlists_ingested: persistedPlaylists.length,
      tracks_ingested: tracksIngested,
    };
  } catch (err: any) {
    console.warn(LOG_PREFIX, "ERROR", { message: err?.message ? String(err.message) : "unknown" });
    return null;
  }
}
