import { resolveArtistSeed, resolveArtistSeedByChannelId } from "./artistResolver";
import { youtubeHydrateArtist } from "./youtubeHydrateArtist";
import { youtubeFetchArtistPlaylists } from "./youtubeFetchArtistPlaylists";
import { youtubeFetchPlaylistTracks } from "./youtubeFetchPlaylistTracks";

export type IngestArtistFromYouTubeInput = {
  artistName: string;
};

export type IngestArtistFromYouTubeByChannelIdInput = {
  youtube_channel_id: string;
};

export type IngestArtistFromYouTubeResult = {
  artist_id: string;
  playlists_ingested: number;
  tracks_ingested: number;
};

function normalizeString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

/**
 * Canonical artist ingestion entry point.
 *
 * Flow:
 * 1) Resolve artist seed (no YouTube calls)
 * 2) Hydrate artist via channels.list (exactly one call)
 * 3) Fetch and persist artist playlists
 * 4) For each playlist, ingest tracks + playlist_tracks
 *
 * Constraints:
 * - Backend-only
 * - No schema guessing in DB writes (delegated to the underlying services)
 * - No retries/fallbacks
 * - Fail-fast: if any step returns null, stop and return null
 */
export async function ingestArtistFromYouTube(input: IngestArtistFromYouTubeInput): Promise<IngestArtistFromYouTubeResult | null> {
  try {
    const artistName = normalizeString(input.artistName);
    if (!artistName) return null;

    console.info("[ingestArtistFromYouTube] resolveArtistSeed:start", { artistName });
    const seedOrArtist = await resolveArtistSeed(artistName);
    if (!seedOrArtist) {
      console.info("[ingestArtistFromYouTube] resolveArtistSeed:missing", { artistName });
      return null;
    }

    const youtube_channel_id = normalizeString((seedOrArtist as any)?.youtube_channel_id);
    const artist_key = normalizeString((seedOrArtist as any)?.artist_key);

    if (!youtube_channel_id) {
      console.info("[ingestArtistFromYouTube] resolveArtistSeed:no_youtube_channel_id", { artistName });
      return null;
    }

    console.info("[ingestArtistFromYouTube] youtubeHydrateArtist:start", { youtube_channel_id });
    const hydratedArtist = await youtubeHydrateArtist({
      youtube_channel_id,
      artistName,
      artist_key,
    });

    if (!hydratedArtist) {
      console.error("[ingestArtistFromYouTube] youtubeHydrateArtist:failed", { youtube_channel_id });
      return null;
    }

    const artist_id = normalizeString((hydratedArtist as any)?.id) || normalizeString((hydratedArtist as any)?.artist_id);
    if (!artist_id) {
      console.error("[ingestArtistFromYouTube] hydrate:missing_artist_id", { youtube_channel_id });
      return null;
    }

    console.info("[ingestArtistFromYouTube] youtubeFetchArtistPlaylists:start", { youtube_channel_id, artist_id });
    const playlists = await youtubeFetchArtistPlaylists({ youtube_channel_id, artist_id });
    if (playlists === null) {
      console.error("[ingestArtistFromYouTube] youtubeFetchArtistPlaylists:failed", { youtube_channel_id });
      return null;
    }

    const playlists_ingested = Array.isArray(playlists) ? playlists.length : 0;
    let tracks_ingested = 0;

    for (const p of Array.isArray(playlists) ? playlists : []) {
      const playlist_id = normalizeString((p as any)?.id) || normalizeString((p as any)?.playlist_id);
      const external_playlist_id = normalizeString((p as any)?.external_id);

      if (!playlist_id || !external_playlist_id) {
        console.error("[ingestArtistFromYouTube] playlist:missing_ids", {
          playlist_id,
          external_playlist_id,
          youtube_channel_id,
        });
        return null;
      }

      console.info("[ingestArtistFromYouTube] youtubeFetchPlaylistTracks:start", { playlist_id, external_playlist_id });
      const inserted = await youtubeFetchPlaylistTracks({ playlist_id, external_playlist_id });
      if (inserted === null) {
        console.error("[ingestArtistFromYouTube] youtubeFetchPlaylistTracks:failed", { playlist_id, external_playlist_id });
        return null;
      }

      tracks_ingested += inserted;
      console.info("[ingestArtistFromYouTube] youtubeFetchPlaylistTracks:done", {
        playlist_id,
        external_playlist_id,
        inserted_tracks: inserted,
      });
    }

    console.info("[ingestArtistFromYouTube] done", { artist_id, playlists_ingested, tracks_ingested });
    return { artist_id, playlists_ingested, tracks_ingested };
  } catch (err) {
    console.error("[ingestArtistFromYouTube] unexpected error:", err);
    return null;
  }
}

/**
 * Canonical ingestion when a concrete youtube_channel_id is known (e.g. user clicked an artist).
 *
 * Differences vs ingestArtistFromYouTube(name):
 * - No ILIKE / fuzzy lookup that could pick the wrong channel.
 * - Still uses youtube_channels for artist name (mapping table), then hydrates via channels.list.
 */
export async function ingestArtistFromYouTubeByChannelId(
  input: IngestArtistFromYouTubeByChannelIdInput
): Promise<IngestArtistFromYouTubeResult | null> {
  try {
    const youtube_channel_id = normalizeString(input.youtube_channel_id);
    if (!youtube_channel_id) return null;

    console.info("[ingestArtistFromYouTubeByChannelId] resolveArtistSeedByChannelId:start", { youtube_channel_id });
    const seedOrArtist = await resolveArtistSeedByChannelId(youtube_channel_id);
    if (!seedOrArtist) {
      console.info("[ingestArtistFromYouTubeByChannelId] resolveArtistSeedByChannelId:missing", { youtube_channel_id });
      return null;
    }

    const artistName = normalizeString((seedOrArtist as any)?.artist) || youtube_channel_id;
    const artist_key = normalizeString((seedOrArtist as any)?.artist_key);

    if (!artist_key) {
      console.info("[ingestArtistFromYouTubeByChannelId] missing artist_key", { youtube_channel_id });
      return null;
    }

    console.info("[ingestArtistFromYouTubeByChannelId] youtubeHydrateArtist:start", { youtube_channel_id });
    const hydratedArtist = await youtubeHydrateArtist({
      youtube_channel_id,
      artistName,
      artist_key,
    });

    if (!hydratedArtist) {
      console.error("[ingestArtistFromYouTubeByChannelId] youtubeHydrateArtist:failed", { youtube_channel_id });
      return null;
    }

    const artist_id = normalizeString((hydratedArtist as any)?.id) || normalizeString((hydratedArtist as any)?.artist_id);
    if (!artist_id) {
      console.error("[ingestArtistFromYouTubeByChannelId] hydrate:missing_artist_id", { youtube_channel_id });
      return null;
    }

    console.info("[ingestArtistFromYouTubeByChannelId] youtubeFetchArtistPlaylists:start", { youtube_channel_id, artist_id });
    const playlists = await youtubeFetchArtistPlaylists({ youtube_channel_id, artist_id });
    if (playlists === null) {
      console.error("[ingestArtistFromYouTubeByChannelId] youtubeFetchArtistPlaylists:failed", { youtube_channel_id });
      return null;
    }

    const playlists_ingested = Array.isArray(playlists) ? playlists.length : 0;
    let tracks_ingested = 0;

    for (const p of Array.isArray(playlists) ? playlists : []) {
      const playlist_id = normalizeString((p as any)?.id) || normalizeString((p as any)?.playlist_id);
      const external_playlist_id = normalizeString((p as any)?.external_id);

      if (!playlist_id || !external_playlist_id) {
        console.error("[ingestArtistFromYouTubeByChannelId] playlist:missing_ids", {
          playlist_id,
          external_playlist_id,
          youtube_channel_id,
        });
        return null;
      }

      console.info("[ingestArtistFromYouTubeByChannelId] youtubeFetchPlaylistTracks:start", { playlist_id, external_playlist_id });
      const inserted = await youtubeFetchPlaylistTracks({ playlist_id, external_playlist_id });
      if (inserted === null) {
        console.error("[ingestArtistFromYouTubeByChannelId] youtubeFetchPlaylistTracks:failed", { playlist_id, external_playlist_id });
        return null;
      }

      tracks_ingested += inserted;
    }

    console.info("[ingestArtistFromYouTubeByChannelId] done", { artist_id, playlists_ingested, tracks_ingested });
    return { artist_id, playlists_ingested, tracks_ingested };
  } catch (err) {
    console.error("[ingestArtistFromYouTubeByChannelId] unexpected error:", err);
    return null;
  }
}
