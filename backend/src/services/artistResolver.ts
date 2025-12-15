import supabase from "./supabaseClient";
import { logApiUsage } from "./apiUsageLogger";

const YOUTUBE_CHANNELS_ENDPOINT = "https://www.googleapis.com/youtube/v3/channels";
const QUOTA_COST_CHANNELS_LIST = 1;

function normalizeString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeNullableString(value: unknown): string | null {
  const s = normalizeString(value);
  return s ? s : null;
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

function normalizeArtistKey(artistName: string): string {
  const raw = typeof artistName === "string" ? artistName : "";

  const cleaned = raw
    .trim()
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  return cleaned.replace(/\s/g, "-");
}

export function deriveArtistKey(artistName: string): string {
  return normalizeArtistKey(artistName);
}

export type YoutubeChannelMapping = {
  name: string | null;
  youtube_channel_id: string;
  thumbnail_url: string | null;
};

export type YouTubeChannelValidationResult =
  | {
      status: "valid";
      youtube_channel_id: string;
      channelTitle: string | null;
      thumbnailUrl: string | null;
      channel: any;
    }
  | { status: "invalid"; youtube_channel_id: string }
  | { status: "error"; youtube_channel_id: string; error: string };

/**
 * STEP 1: Always validate a channelId against YouTube before use.
 *
 * Rules:
 * - 200 + items[] => valid
 * - 200 + empty items OR 404 => invalid
 * - Other non-2xx => error
 */
export async function validateYouTubeChannelId(youtube_channel_id: string): Promise<YouTubeChannelValidationResult> {
  const apiKey = getApiKey();
  const id = normalizeString(youtube_channel_id);
  if (!id) return { status: "invalid", youtube_channel_id: "" };
  if (!apiKey) return { status: "error", youtube_channel_id: id, error: "Missing YOUTUBE_API_KEY" };

  const url = new URL(YOUTUBE_CHANNELS_ENDPOINT);
  url.searchParams.set("key", apiKey);
  url.searchParams.set("part", "snippet,brandingSettings,statistics");
  url.searchParams.set("id", id);
  url.searchParams.set(
    "fields",
    "items(id,snippet(title,thumbnails(default(url),medium(url),high(url))),brandingSettings(channel(unsubscribedTrailer),image(bannerExternalUrl)),statistics(subscriberCount,viewCount))"
  );

  let status: "ok" | "error" = "ok";
  let errorCode: string | null = null;
  let errorMessage: string | null = null;

  try {
    const response = await fetch(url.toString(), { method: "GET" });

    if (response.status === 404) {
      status = "error";
      errorCode = "404";
      errorMessage = "YouTube channels.list not found";
      return { status: "invalid", youtube_channel_id: id };
    }

    if (!response.ok) {
      status = "error";
      errorCode = String(response.status);
      errorMessage = "YouTube channels.list failed";
      return { status: "error", youtube_channel_id: id, error: "YouTube channels.list failed" };
    }

    const json = await response.json().catch(() => null);
    if (!json || typeof json !== "object") {
      status = "error";
      errorMessage = "YouTube channels.list failed";
      return { status: "error", youtube_channel_id: id, error: "YouTube channels.list failed" };
    }

    const items = Array.isArray((json as any).items) ? (json as any).items : [];
    if (items.length === 0) {
      return { status: "invalid", youtube_channel_id: id };
    }

    const channel = items[0];
    const title = normalizeNullableString(channel?.snippet?.title);
    const thumb = pickBestThumbnailUrl(channel?.snippet?.thumbnails);

    return {
      status: "valid",
      youtube_channel_id: id,
      channelTitle: title,
      thumbnailUrl: thumb,
      channel,
    };
  } catch (err: any) {
    status = "error";
    errorMessage = err?.message ? String(err.message) : "YouTube channels.list failed";
    return { status: "error", youtube_channel_id: id, error: "YouTube channels.list failed" };
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

export async function findYoutubeChannelMappingByArtistName(artistName: string): Promise<YoutubeChannelMapping | null> {
  if (!supabase) return null;
  const q = normalizeString(artistName);
  if (!q || q.length < 2) return null;

  const { data, error } = await supabase
    .from("youtube_channels")
    .select("name, youtube_channel_id, thumbnail_url")
    .ilike("name", `%${q}%`)
    .limit(1)
    .maybeSingle();

  if (error) return null;
  const name = typeof (data as any)?.name === "string" ? String((data as any).name).trim() : "";
  const youtube_channel_id = typeof (data as any)?.youtube_channel_id === "string" ? String((data as any).youtube_channel_id).trim() : "";
  const thumbnail_url = typeof (data as any)?.thumbnail_url === "string" ? String((data as any).thumbnail_url) : null;

  if (!youtube_channel_id) return null;
  return { name: name || null, youtube_channel_id, thumbnail_url };
}

export async function upsertYoutubeChannelMapping(input: {
  name: string;
  youtube_channel_id: string;
  thumbnail_url: string | null;
}): Promise<YoutubeChannelMapping | null> {
  if (!supabase) return null;

  const youtube_channel_id = normalizeString(input.youtube_channel_id);
  const name = normalizeString(input.name);
  const thumbnail_url = normalizeNullableString(input.thumbnail_url);
  if (!youtube_channel_id || !name) return null;

  const row = {
    name,
    youtube_channel_id,
    thumbnail_url,
  };

  const { data, error } = await supabase
    .from("youtube_channels")
    .upsert(row, { onConflict: "youtube_channel_id" })
    .select("name, youtube_channel_id, thumbnail_url")
    .maybeSingle();

  if (error) return null;
  const outName = typeof (data as any)?.name === "string" ? String((data as any).name).trim() : "";
  const outId = typeof (data as any)?.youtube_channel_id === "string" ? String((data as any).youtube_channel_id).trim() : "";
  const outThumb = typeof (data as any)?.thumbnail_url === "string" ? String((data as any).thumbnail_url) : null;
  if (!outId) return null;
  return { name: outName || null, youtube_channel_id: outId, thumbnail_url: outThumb };
}

export async function deleteYoutubeChannelMappingByChannelId(youtube_channel_id: string): Promise<boolean> {
  if (!supabase) return false;
  const id = normalizeString(youtube_channel_id);
  if (!id) return false;

  const { error } = await supabase.from("youtube_channels").delete().eq("youtube_channel_id", id);
  return !error;
}
