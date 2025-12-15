import supabase from "./supabaseClient";
import { logApiUsage } from "./apiUsageLogger";

const YOUTUBE_CHANNELS_ENDPOINT = "https://www.googleapis.com/youtube/v3/channels";
const QUOTA_COST_CHANNELS_LIST = 1;

export type YoutubeHydrateArtistInput = {
  youtube_channel_id: string;
  artistName: string;
  artist_key: string;
};

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

function getApiKey(): string | null {
  const apiKey = process.env.YOUTUBE_API_KEY;
  return typeof apiKey === "string" && apiKey.trim() ? apiKey.trim() : null;
}

function pickBestThumbnailUrl(thumbnails: any): string | null {
  return (
    normalizeNullableString(thumbnails?.high?.url) ||
    normalizeNullableString(thumbnails?.medium?.url) ||
    normalizeNullableString(thumbnails?.default?.url)
  );
}

async function fetchChannelOnce(youtube_channel_id: string): Promise<any | null> {
  const apiKey = getApiKey();
  if (!apiKey) return null;

  const id = normalizeString(youtube_channel_id);
  if (!id) return null;

  const url = new URL(YOUTUBE_CHANNELS_ENDPOINT);
  url.searchParams.set("part", "snippet,brandingSettings,statistics");
  url.searchParams.set("id", id);
  url.searchParams.set("key", apiKey);
  url.searchParams.set(
    "fields",
    "items(id,snippet(country,thumbnails(default(url),medium(url),high(url))),brandingSettings(channel(unsubscribedTrailer),image(bannerExternalUrl)),statistics(subscriberCount,viewCount))"
  );

  let status: "ok" | "error" = "ok";
  let errorCode: string | null = null;
  let errorMessage: string | null = null;

  try {
    const response = await fetch(url.toString(), { method: "GET" });
    if (!response.ok) {
      status = "error";
      errorCode = String(response.status);
      errorMessage = "YouTube channels.list failed";
      return null;
    }

    const json = await response.json().catch(() => null);
    if (!json || typeof json !== "object") {
      status = "error";
      errorMessage = "YouTube channels.list failed";
      return null;
    }

    return json;
  } catch (err: any) {
    status = "error";
    errorMessage = err?.message ? String(err.message) : "YouTube channels.list failed";
    return null;
  } finally {
    void logApiUsage({
      apiKeyOrIdentifier: apiKey,
      endpoint: "youtube.channels.list",
      quotaCost: QUOTA_COST_CHANNELS_LIST,
      status,
      errorCode,
      errorMessage,
    });
  }
}

function normalizeToArtistsUpsertRow(input: YoutubeHydrateArtistInput, channel: any): ArtistsUpsertRow | null {
  const youtube_channel_id = normalizeString(input.youtube_channel_id);
  const artist = normalizeString(input.artistName);
  const artist_key = normalizeString(input.artist_key);

  if (!youtube_channel_id || !artist || !artist_key) return null;

  const snippet = channel?.snippet;
  const brandingSettings = channel?.brandingSettings;
  const statistics = channel?.statistics;

  const thumbnail_url = pickBestThumbnailUrl(snippet?.thumbnails);

  const banner_url =
    normalizeNullableString(brandingSettings?.channel?.unsubscribedTrailer) ||
    normalizeNullableString(brandingSettings?.image?.bannerExternalUrl);

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
 * Canonical artist hydration implementation.
 *
 * Behavior:
 * - Exactly one YouTube Data API call (channels.list)
 * - Normalizes and UPSERTs into `artists` using youtube_channel_id as the unique key
 * - Never throws (returns null on any failure)
 */
export async function youtubeHydrateArtist(input: YoutubeHydrateArtistInput): Promise<any | null> {
  try {
    if (!supabase) return null;

    const youtube_channel_id = normalizeString(input.youtube_channel_id);
    if (!youtube_channel_id) return null;

    const json = await fetchChannelOnce(youtube_channel_id);
    if (!json) return null;

    const items = Array.isArray((json as any).items) ? (json as any).items : [];
    const channel = items.length > 0 ? items[0] : null;
    if (!channel) return null;

    const row = normalizeToArtistsUpsertRow(input, channel);
    if (!row) return null;

    const { data, error } = await supabase
      .from("artists")
      .upsert(row, { onConflict: "youtube_channel_id" })
      .select("*")
      .maybeSingle();

    if (error) {
      console.error("[youtubeHydrateArtist] upsert failed:", error);
      return null;
    }

    return data ?? null;
  } catch (err) {
    console.error("[youtubeHydrateArtist] unexpected error:", err);
    return null;
  }
}
