import supabase from "./supabaseClient";
import { logApiUsage } from "./apiUsageLogger";

const YOUTUBE_PLAYLISTS_ENDPOINT = "https://www.googleapis.com/youtube/v3/playlists";
const QUOTA_COST_PLAYLISTS_LIST = 1;

export type YoutubeFetchArtistPlaylistsInput = {
  youtube_channel_id: string;
  artist_id: string;
};

type PlaylistInsertRow = {
  external_id: string;
  title: string;
  description: string | null;
  cover_url: string | null;
  channel_id: string;
  channel_title: string;
  item_count: number;
  sync_status: "fetched";
};

function normalizeString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeNullableString(value: unknown): string | null {
  const s = normalizeString(value);
  return s ? s : null;
}

function normalizeItemCount(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) return Math.max(0, Math.trunc(value));
  if (typeof value === "string" && value.trim()) {
    const n = Number.parseInt(value.trim(), 10);
    return Number.isFinite(n) ? Math.max(0, n) : 0;
  }
  return 0;
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

function isOfficialAlbumLike(title: string, description: string | null): boolean {
  const t = title.toLowerCase();
  const d = (description || "").toLowerCase();
  const haystack = `${t} ${d}`;

  const includeHints = [
    "album",
    "full album",
    "official album",
    "studio album",
    "ep",
    "lp",
    "mixtape",
  ];

  const excludeHints = [
    "mix",
    "mashup",
    "shorts",
    "live",
    "concert",
    "reaction",
    "lyrics",
    "lyric",
    "fan made",
    "fan-made",
    "best of",
    "top ",
    "hits",
    "compilation",
    "cover",
  ];

  const hasInclude = includeHints.some((k) => haystack.includes(k));
  if (!hasInclude) return false;

  const hasExclude = excludeHints.some((k) => haystack.includes(k));
  if (hasExclude && !haystack.includes("official album")) return false;

  return true;
}

async function fetchPlaylistsOnce(youtube_channel_id: string): Promise<any | null> {
  const apiKey = getApiKey();
  if (!apiKey) return null;

  const channelId = normalizeString(youtube_channel_id);
  if (!channelId) return null;

  const url = new URL(YOUTUBE_PLAYLISTS_ENDPOINT);
  url.searchParams.set("key", apiKey);
  url.searchParams.set("part", "snippet,contentDetails");
  url.searchParams.set("channelId", channelId);
  url.searchParams.set("maxResults", "50");
  url.searchParams.set(
    "fields",
    "items(id,snippet(title,description,channelTitle,thumbnails(default(url),medium(url),high(url))),contentDetails(itemCount))"
  );

  let status: "ok" | "error" = "ok";
  let errorCode: string | null = null;
  let errorMessage: string | null = null;

  try {
    const response = await fetch(url.toString(), { method: "GET" });
    if (!response.ok) {
      status = "error";
      errorCode = String(response.status);
      errorMessage = "YouTube playlists.list failed";
      return null;
    }

    const json = await response.json().catch(() => null);
    if (!json || typeof json !== "object") {
      status = "error";
      errorMessage = "YouTube playlists.list failed";
      return null;
    }

    return json;
  } catch (err: any) {
    status = "error";
    errorMessage = err?.message ? String(err.message) : "YouTube playlists.list failed";
    return null;
  } finally {
    void logApiUsage({
      apiKeyOrIdentifier: apiKey,
      endpoint: "youtube.playlists.list",
      quotaCost: QUOTA_COST_PLAYLISTS_LIST,
      status,
      errorCode,
      errorMessage,
    });
  }
}

function normalizeToInsertRows(json: any, youtube_channel_id: string): PlaylistInsertRow[] {
  const items = Array.isArray(json?.items) ? json.items : [];
  const out: PlaylistInsertRow[] = [];
  const seen = new Set<string>();

  for (const item of items) {
    const external_id = normalizeString(item?.id);
    const snippet = item?.snippet;
    const contentDetails = item?.contentDetails;

    const title = normalizeString(snippet?.title);
    const description = normalizeNullableString(snippet?.description);
    const channel_title = normalizeString(snippet?.channelTitle);
    const cover_url = pickBestThumbnailUrl(snippet?.thumbnails);
    const item_count = normalizeItemCount(contentDetails?.itemCount);

    if (!external_id || !title || !channel_title) continue;
    if (seen.has(external_id)) continue;

    if (!isOfficialAlbumLike(title, description)) continue;

    seen.add(external_id);
    out.push({
      external_id,
      title,
      description,
      cover_url,
      channel_id: youtube_channel_id,
      channel_title,
      item_count,
      sync_status: "fetched",
    });
  }

  return out;
}

/**
 * Canonical artist-playlists fetcher.
 *
 * Behavior:
 * - One YouTube Data API call (playlists.list)
 * - Filters album/official-style playlists using title/description heuristics
 * - Persists to `playlists` using ONLY the explicitly allowed columns
 * - Never throws (returns null on any failure)
 */
export async function youtubeFetchArtistPlaylists(input: YoutubeFetchArtistPlaylistsInput): Promise<any[] | null> {
  try {
    void input.artist_id;
    if (!supabase) return null;

    const youtube_channel_id = normalizeString(input.youtube_channel_id);
    if (!youtube_channel_id) return null;

    const json = await fetchPlaylistsOnce(youtube_channel_id);
    if (!json) return null;

    const rows = normalizeToInsertRows(json, youtube_channel_id);
    if (rows.length === 0) return [];

    // NOTE: Insert-only is intentional here to avoid guessing the unique constraint.
    // If the schema enforces uniqueness and conflicts occur, this will fail and return null.
    const { data, error } = await supabase.from("playlists").insert(rows).select("*");
    if (error) {
      console.error("[youtubeFetchArtistPlaylists] insert failed:", error);
      return null;
    }

    return Array.isArray(data) ? data : [];
  } catch (err) {
    console.error("[youtubeFetchArtistPlaylists] unexpected error:", err);
    return null;
  }
}
