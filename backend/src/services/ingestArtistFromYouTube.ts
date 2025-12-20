import supabase from "./supabaseClient";
import {
  deleteYoutubeChannelMappingByChannelId,
  deriveArtistKey,
  findYoutubeChannelMappingByArtistName,
  validateYouTubeChannelId,
} from "./artistResolver";
import { youtubeSearchArtistChannel } from "./youtubeClient";
import { youtubeFetchArtistPlaylists } from "./youtubeFetchArtistPlaylists";
import { youtubeBatchFetchPlaylists } from "./youtubeBatchFetchPlaylists";
import { ingestArtistFromYouTubeSearch } from "./ingestArtistFromYouTubeSearch";

export type IngestArtistFromYouTubeInput = {
  artistName: string;
};

export type IngestArtistFromYouTubeByChannelIdInput = {
  youtube_channel_id: string;
  artistName?: string;
  // Optional ingestion limits (delta ingestion).
  max_playlists?: number;
  max_tracks?: number;
};

export type IngestArtistFromYouTubeResult = {
  artist_id: string;
  playlists_ingested: number;
  tracks_ingested: number;
};

function normalizeString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeNullableString(value: unknown): string | null {
  const s = normalizeString(value);
  return s ? s : null;
}

function parseNullableInt(value: unknown): number | null {
  const raw = typeof value === "string" ? value.trim() : value;

  if (typeof raw === "number" && Number.isFinite(raw)) return Math.trunc(raw);
  if (typeof raw === "string" && raw) {
    const n = Number.parseInt(raw, 10);
    return Number.isFinite(n) ? n : null;
  }

  return null;
}

function pickBestThumbnailUrl(thumbnails: any): string | null {
  return (
    normalizeNullableString(thumbnails?.high?.url) ||
    normalizeNullableString(thumbnails?.medium?.url) ||
    normalizeNullableString(thumbnails?.default?.url)
  );
}

type ArtistsUpsertRow = {
  artist: string;
  artist_key: string;
  youtube_channel_id: string;
  thumbnail_url: string | null;
  banner_url: string | null;
  subscribers: number | null;
  views: number | null;
  country: string | null;
  source: "youtube";
};

function normalizeToArtistsUpsertRow(opts: {
  artistName: string;
  youtube_channel_id: string;
  channel: any;
}): ArtistsUpsertRow | null {
  const youtube_channel_id = normalizeString(opts.youtube_channel_id);
  const artist = normalizeString(opts.artistName);
  const artist_key = deriveArtistKey(artist);
  if (!youtube_channel_id || !artist || !artist_key) return null;

  const snippet = opts.channel?.snippet;
  const brandingSettings = opts.channel?.brandingSettings;
  const statistics = opts.channel?.statistics;

  const thumbnail_url = pickBestThumbnailUrl(snippet?.thumbnails);
  const banner_url = normalizeNullableString(brandingSettings?.image?.bannerExternalUrl);
  const subscribers = parseNullableInt(statistics?.subscriberCount);
  const views = parseNullableInt(statistics?.viewCount);
  const country = normalizeNullableString(snippet?.country);

  return {
    artist,
    artist_key,
    youtube_channel_id,
    thumbnail_url,
    banner_url,
    subscribers,
    views,
    country,
    source: "youtube",
  };
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
    if (!supabase) return null;

    const artistName = normalizeString(input.artistName);
    if (!artistName) return null;

    // No YouTube search fallback here (quota=100 is only allowed in the route).
    // We may only use existing Supabase mapping, but must validate before use.
    const mapping = await findYoutubeChannelMappingByArtistName(artistName);
    if (!mapping?.youtube_channel_id) return null;

    return await ingestArtistFromYouTubeByChannelId({
      youtube_channel_id: mapping.youtube_channel_id,
      artistName,
    });
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
    if (!supabase) return null;

    const youtube_channel_id = normalizeString(input.youtube_channel_id);
    if (!youtube_channel_id) return null;

    // STEP 1: Always validate BEFORE any playlist fetch.
    const validation = await validateYouTubeChannelId(youtube_channel_id);
    if (validation.status === "invalid") {
      await deleteYoutubeChannelMappingByChannelId(youtube_channel_id);
      return null;
    }
    if (validation.status === "error") {
      return null;
    }

    const artistName = normalizeString(input.artistName) || normalizeString(validation.channelTitle) || youtube_channel_id;

    const artistRow = normalizeToArtistsUpsertRow({
      artistName,
      youtube_channel_id,
      channel: validation.channel,
    });
    if (!artistRow) return null;

    let artist_id = "local-only";
    try {
      const { data: hydratedArtist, error: artistUpsertError } = await supabase
        .from("artists")
        .upsert(artistRow, { onConflict: "youtube_channel_id" })
        .select("*")
        .maybeSingle();

      if (artistUpsertError) {
        // Some environments restrict the artists table; continue ingestion without it.
        console.warn("[ingestArtistFromYouTubeByChannelId] artists upsert failed (continuing):", {
          code: (artistUpsertError as any)?.code ?? null,
          message: (artistUpsertError as any)?.message ?? "unknown",
        });
      } else {
        const id = normalizeString((hydratedArtist as any)?.id) || normalizeString((hydratedArtist as any)?.artist_id);
        if (id) artist_id = id;
      }
    } catch (e: any) {
      console.warn("[ingestArtistFromYouTubeByChannelId] artists upsert unexpected error (continuing):", {
        message: e?.message ? String(e.message) : "unknown",
      });
    }

    // STEP 5: Hydration (valid channel only)
    const maxPlaylistsRaw = input.max_playlists;
    const maxPlaylists = typeof maxPlaylistsRaw === "number" && Number.isFinite(maxPlaylistsRaw) ? Math.max(0, Math.trunc(maxPlaylistsRaw)) : null;

    const maxTracksRaw = input.max_tracks;
    const maxTracks = typeof maxTracksRaw === "number" && Number.isFinite(maxTracksRaw) ? Math.max(0, Math.trunc(maxTracksRaw)) : null;

    const allPlaylists: any[] = [];

    // 1) Primary (official) channel playlists
    const primaryPlaylists = await youtubeFetchArtistPlaylists({
      youtube_channel_id,
      artist_id,
      max_playlists: maxPlaylists ?? undefined,
    });
    if (primaryPlaylists === null) return null;
    allPlaylists.push(...(Array.isArray(primaryPlaylists) ? primaryPlaylists : []));

    // 2) Topic channel playlists (often where official album playlists live)
    // Best-effort: if we can't find/validate it, continue with primary.
    try {
      const query = `${artistName} - Topic`;
      const candidates = await youtubeSearchArtistChannel(query);
      const best = (Array.isArray(candidates) ? candidates : []).find((c) => {
        const title = normalizeString((c as any)?.title).toLowerCase();
        return title === query.toLowerCase() || title.endsWith("- topic");
      });

      const topicChannelId = normalizeString((best as any)?.channelId);
      if (topicChannelId && topicChannelId !== youtube_channel_id) {
        const topicValidation = await validateYouTubeChannelId(topicChannelId);
        if (topicValidation.status === "valid") {
          const topicPlaylists = await youtubeFetchArtistPlaylists({
            youtube_channel_id: topicChannelId,
            artist_id,
            // Store under primary channel so /api/artist lists them.
            store_channel_id_override: youtube_channel_id,
            store_channel_title_override: artistName,
          });
          if (topicPlaylists === null) return null;
          allPlaylists.push(...(Array.isArray(topicPlaylists) ? topicPlaylists : []));
        }
      }
    } catch (e) {
      void e;
    }

    // Dedupe by playlist id
    const deduped = new Map<string, any>();
    for (const p of allPlaylists) {
      const playlist_id = normalizeString((p as any)?.id) || normalizeString((p as any)?.playlist_id);
      if (playlist_id) deduped.set(playlist_id, p);
    }

    const playlists = Array.from(deduped.values());
    const playlists_ingested = playlists.length;
    let tracks_ingested = 0;

    const batchItems = (Array.isArray(playlists) ? playlists : [])
      .map((p) => {
        const playlist_id = normalizeString((p as any)?.id) || normalizeString((p as any)?.playlist_id);
        const external_playlist_id = normalizeString((p as any)?.external_id);
        if (!playlist_id || !external_playlist_id) return null;
        return {
          playlist_id,
          external_playlist_id,
          artist_override: artistName,
          artist_channel_id_override: youtube_channel_id,
        };
      })
      .filter((x): x is NonNullable<typeof x> => Boolean(x));

    const batchRes = await youtubeBatchFetchPlaylists(batchItems, { max_total_tracks: maxTracks ?? undefined });
    tracks_ingested += batchRes.tracks_ingested;

    // EXTRA: search-based ingestion to capture "regular" playlists/videos beyond the official channel.
    // Bounded to avoid burning quota.
    try {
      const needMore = playlists_ingested < 5 || tracks_ingested < 10;
      if (needMore) {
        const remainingTracks = maxTracks !== null ? Math.max(0, maxTracks - tracks_ingested) : null;
        const searchMaxTracks = remainingTracks !== null ? Math.min(remainingTracks, 50) : 50;
        const searchMaxPlaylists = maxPlaylists !== null ? Math.min(maxPlaylists, 10) : 10;

        const searchRes = await ingestArtistFromYouTubeSearch({
          artistName,
          store_channel_id_override: youtube_channel_id,
          store_channel_title_override: artistName,
          max_playlists: searchMaxPlaylists,
          max_tracks: searchMaxTracks,
        });
        if (searchRes) tracks_ingested += searchRes.tracks_ingested;
      }
    } catch {
      // Best-effort only.
    }

    return { artist_id, playlists_ingested, tracks_ingested };
  } catch (err) {
    console.error("[ingestArtistFromYouTubeByChannelId] unexpected error:", err);
    return null;
  }
}
