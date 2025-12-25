import supabase from "./supabaseClient";
import { deriveArtistKey, findYoutubeChannelMappingByArtistName, validateYouTubeChannelId } from "./artistResolver";
import { youtubeFetchArtistPlaylists } from "./youtubeFetchArtistPlaylists";
import { youtubeBatchFetchPlaylists } from "./youtubeBatchFetchPlaylists";
import { ingestArtistFromYouTubeSearch } from "./ingestArtistFromYouTubeSearch";

export type IngestArtistFromYouTubeInput = { artistName: string };

export type IngestArtistFromYouTubeByChannelIdInput = {
  youtube_channel_id: string;
  artistName?: string;
  max_playlists?: number;
  max_tracks?: number;
};

export type IngestArtistFromYouTubeResult = {
  artist_id: string;
  playlists_ingested: number;
  tracks_ingested: number;
};

// Helpers

function normalizeString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeNullableString(value: unknown): string | null {
  const s = normalizeString(value);
  return s || null;
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

function stripTopicSuffix(name: string): string {
  const cleaned = normalizeString(name);
  return cleaned.replace(/\s*-\s*topic$/i, "").trim();
}

async function findExistingArtist(opts: { artist_key: string; youtube_channel_id: string }): Promise<string | null> {
  if (!supabase) return null;
  const { artist_key, youtube_channel_id } = opts;

  const { data, error } = await supabase
    .from("artists")
    .select("id")
    .or(`artist_key.eq.${artist_key},youtube_channel_id.eq.${youtube_channel_id}`)
    .maybeSingle();

  if (error) return null;
  const id = normalizeString((data as any)?.id);
  return id || null;
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

function buildArtistRow(opts: { artistName: string; youtube_channel_id: string; channel: any }): ArtistsUpsertRow | null {
  const youtube_channel_id = normalizeString(opts.youtube_channel_id);
  const baseName = stripTopicSuffix(opts.artistName);
  const artist = normalizeString(baseName);
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

// Entry points

export async function ingestArtistFromYouTube(input: IngestArtistFromYouTubeInput): Promise<IngestArtistFromYouTubeResult | null> {
  try {
    if (!supabase) return null;

    const artistName = normalizeString(input.artistName);
    if (!artistName) return null;

    const mapping = await findYoutubeChannelMappingByArtistName(artistName);
    if (!mapping?.youtube_channel_id) return null;

    return await ingestArtistFromYouTubeByChannelId({ youtube_channel_id: mapping.youtube_channel_id, artistName });
  } catch (err) {
    console.error("[ingestArtistFromYouTube] unexpected error", { message: (err as any)?.message });
    return null;
  }
}

export async function ingestArtistFromYouTubeByChannelId(
  input: IngestArtistFromYouTubeByChannelIdInput
): Promise<IngestArtistFromYouTubeResult | null> {
  try {
    if (!supabase) return null;

    const youtube_channel_id = normalizeString(input.youtube_channel_id);
    if (!youtube_channel_id) return null;

    const validation = await validateYouTubeChannelId(youtube_channel_id);
    if (validation.status !== "valid") return null;

    const providedName = normalizeString(input.artistName) || normalizeString(validation.channelTitle) || youtube_channel_id;
    const baseName = stripTopicSuffix(providedName);

    // Block Topic channels explicitly.
    if (/\s*-\s*topic$/i.test(providedName)) {
      console.info("[ingestArtistFromYouTubeByChannelId] skip topic channel", { youtube_channel_id, title: providedName });
      return null;
    }

    const artistRow = buildArtistRow({ artistName: baseName, youtube_channel_id, channel: validation.channel });
    if (!artistRow) return null;

    const existingId = await findExistingArtist({ artist_key: artistRow.artist_key, youtube_channel_id });
    let artist_id = existingId;

    if (existingId) {
      console.info("[ingestArtistFromYouTubeByChannelId] reuse existing artist", { youtube_channel_id, artist_id: existingId });
    } else {
      const { data, error } = await supabase.from("artists").upsert(artistRow, { onConflict: "youtube_channel_id" }).select("id").maybeSingle();
      if (error) {
        console.warn("[ingestArtistFromYouTubeByChannelId] artist insert failed", { message: error.message });
        return null;
      }
      artist_id = normalizeString((data as any)?.id) || null;
    }

    if (!artist_id) return null;

    // Playlist + track ingestion (single canonical path)
    const maxPlaylistsRaw = input.max_playlists;
    const maxPlaylists = typeof maxPlaylistsRaw === "number" && Number.isFinite(maxPlaylistsRaw) ? Math.max(0, Math.trunc(maxPlaylistsRaw)) : null;

    const maxTracksRaw = input.max_tracks;
    const maxTracks = typeof maxTracksRaw === "number" && Number.isFinite(maxTracksRaw) ? Math.max(0, Math.trunc(maxTracksRaw)) : null;

    const playlists = await youtubeFetchArtistPlaylists({
      youtube_channel_id,
      artist_id,
      max_playlists: maxPlaylists ?? undefined,
    });
    if (playlists === null) return null;

    const unique = new Map<string, any>();
    for (const p of Array.isArray(playlists) ? playlists : []) {
      const pid = normalizeString((p as any)?.id) || normalizeString((p as any)?.playlist_id);
      if (pid) unique.set(pid, p);
    }

    const playlistItems = Array.from(unique.values())
      .map((p) => {
        const playlist_id = normalizeString((p as any)?.id) || normalizeString((p as any)?.playlist_id);
        const external_playlist_id = normalizeString((p as any)?.external_id);
        if (!playlist_id || !external_playlist_id) return null;
        return {
          playlist_id,
          external_playlist_id,
          artist_override: artistRow.artist,
          artist_channel_id_override: youtube_channel_id,
        };
      })
      .filter((x): x is NonNullable<typeof x> => Boolean(x));

    const batchRes = await youtubeBatchFetchPlaylists(playlistItems, { max_total_tracks: maxTracks ?? undefined });

    // Optional search-based enrichment (best-effort, bounded)
    try {
      const needMore = unique.size < 5 || batchRes.tracks_ingested < 10;
      if (needMore) {
        const remainingTracks = maxTracks !== null ? Math.max(0, maxTracks - batchRes.tracks_ingested) : null;
        const searchMaxTracks = remainingTracks !== null ? Math.min(remainingTracks, 50) : 50;
        const searchMaxPlaylists = maxPlaylists !== null ? Math.min(maxPlaylists, 10) : 10;

        await ingestArtistFromYouTubeSearch({
          artistName: artistRow.artist,
          store_channel_id_override: youtube_channel_id,
          store_channel_title_override: artistRow.artist,
          max_playlists: searchMaxPlaylists,
          max_tracks: searchMaxTracks,
        });
      }
    } catch {
      // ignore search enrichment failures
    }

    return {
      artist_id,
      playlists_ingested: unique.size,
      tracks_ingested: batchRes.tracks_ingested,
    };
  } catch (err) {
    console.error("[ingestArtistFromYouTubeByChannelId] unexpected error", { message: (err as any)?.message });
    return null;
  }
}
