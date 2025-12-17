import supabase from "./supabaseClient";
import { logApiUsage } from "./apiUsageLogger";

const YOUTUBE_PLAYLISTS_ENDPOINT = "https://www.googleapis.com/youtube/v3/playlists";
const QUOTA_COST_PLAYLISTS_LIST = 1;

export type YoutubeFetchArtistPlaylistsInput = {
  // Channel to fetch playlists from.
  youtube_channel_id: string;
  artist_id: string;
  // Optional: store fetched playlists under a different channel id/title.
  // Used to attach Topic-channel album playlists to the primary artist channel page.
  store_channel_id_override?: string;
  store_channel_title_override?: string;
  // Optional: limit number of playlists persisted.
  // Used by the Search resolve "delta ingestion" flow.
  max_playlists?: number;
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

async function fetchPlaylistsPage(youtube_channel_id: string, pageToken?: string | null): Promise<any | null> {
  const apiKey = getApiKey();
  if (!apiKey) return null;

  const channelId = normalizeString(youtube_channel_id);
  if (!channelId) return null;

  const url = new URL(YOUTUBE_PLAYLISTS_ENDPOINT);
  url.searchParams.set("key", apiKey);
  url.searchParams.set("part", "snippet,contentDetails");
  url.searchParams.set("channelId", channelId);
  url.searchParams.set("maxResults", "50");
  if (pageToken) url.searchParams.set("pageToken", pageToken);
  url.searchParams.set(
    "fields",
    "items(id,snippet(title,description,channelTitle,thumbnails(default(url),medium(url),high(url))),contentDetails(itemCount)),nextPageToken"
  );

  let status: "ok" | "error" = "ok";
  let errorCode: string | null = null;
  let errorMessage: string | null = null;
  let quotaCost = QUOTA_COST_PLAYLISTS_LIST;

  try {
    const response = await fetch(url.toString(), { method: "GET" });

    const quotaHeader = response.headers.get("x-goog-quota-used");
    if (quotaHeader) {
      const parsed = Number.parseFloat(quotaHeader);
      if (Number.isFinite(parsed) && parsed >= 0) quotaCost = parsed;
    }

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
      quotaCost,
      status,
      errorCode,
      errorMessage,
    });
  }
}

async function fetchPlaylistsAll(youtube_channel_id: string, opts?: { max_playlists?: number | null }): Promise<any[] | null> {
  const maxRaw = opts?.max_playlists;
  const maxPlaylists = typeof maxRaw === "number" && Number.isFinite(maxRaw) ? Math.max(0, Math.trunc(maxRaw)) : null;
  if (maxPlaylists === 0) return [];

  const out: any[] = [];
  let pageToken: string | null = null;
  let guard = 0;

  while (true) {
    guard += 1;
    if (guard > 50) break;

    const json = await fetchPlaylistsPage(youtube_channel_id, pageToken);
    if (!json) return null;

    const items = Array.isArray((json as any)?.items) ? (json as any).items : [];
    out.push(...items);

    if (maxPlaylists !== null && out.length >= maxPlaylists) {
      return out.slice(0, maxPlaylists);
    }

    pageToken = normalizeNullableString((json as any)?.nextPageToken);
    if (!pageToken) break;
  }

  return out;
}

function normalizeToInsertRows(
  items: any[],
  youtube_channel_id: string,
  storeChannel: { id: string; title: string },
  opts?: { max_playlists?: number | null }
): PlaylistInsertRow[] {
  const preferred: PlaylistInsertRow[] = [];
  const fallback: PlaylistInsertRow[] = [];
  const seen = new Set<string>();

  const maxRaw = opts?.max_playlists;
  const maxPlaylists = typeof maxRaw === "number" && Number.isFinite(maxRaw) ? Math.max(0, Math.trunc(maxRaw)) : null;
  if (maxPlaylists === 0) return [];

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

    seen.add(external_id);
    const row: PlaylistInsertRow = {
      external_id,
      title,
      description,
      cover_url,
      channel_id: storeChannel.id || youtube_channel_id,
      channel_title: storeChannel.title || channel_title,
      item_count,
      sync_status: "fetched",
    };

    if (isOfficialAlbumLike(title, description)) {
      preferred.push(row);
    } else {
      fallback.push(row);
    }
  }

  const out: PlaylistInsertRow[] = [];
  for (const row of preferred) {
    out.push(row);
    if (maxPlaylists !== null && out.length >= maxPlaylists) return out;
  }
  for (const row of fallback) {
    out.push(row);
    if (maxPlaylists !== null && out.length >= maxPlaylists) return out;
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

    const storeChannelId = normalizeString(input.store_channel_id_override) || youtube_channel_id;
    const storeChannelTitle = normalizeString(input.store_channel_title_override);

    const items = await fetchPlaylistsAll(youtube_channel_id, { max_playlists: input.max_playlists ?? null });
    if (!items) return null;

    const rows = normalizeToInsertRows(items, youtube_channel_id, { id: storeChannelId, title: storeChannelTitle }, { max_playlists: input.max_playlists ?? null });
    if (rows.length === 0) return [];

    // Upsert is required for repeat-safe hydration.
    // Existing codebase assumes playlists are unique by external_id (see batch refresh logic).
    const { data, error } = await supabase
      .from("playlists")
      .upsert(rows, { onConflict: "external_id" })
      .select("*");
    if (error) {
      console.error("[youtubeFetchArtistPlaylists] upsert failed:", error);
      return null;
    }

    return Array.isArray(data) ? data : [];
  } catch (err) {
    console.error("[youtubeFetchArtistPlaylists] unexpected error:", err);
    return null;
  }
}
