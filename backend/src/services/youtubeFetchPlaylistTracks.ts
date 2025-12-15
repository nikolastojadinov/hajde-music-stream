import supabase from "./supabaseClient";
import { logApiUsage } from "./apiUsageLogger";

const YOUTUBE_API_BASE = "https://www.googleapis.com/youtube/v3";
const QUOTA_COST_PLAYLIST_ITEMS_LIST = 1;
const QUOTA_COST_VIDEOS_LIST = 1;

const YOUTUBE_PAGE_SIZE = 50;
const MAX_PLAYLIST_PAGES = 5;
const VIDEO_BATCH_SIZE = 50;
const TRACK_UPSERT_CHUNK_SIZE = 200;
const PLAYLIST_TRACKS_CHUNK_SIZE = 500;

export type YoutubeFetchPlaylistTracksInput = {
  playlist_id: string;
  youtube_playlist_id: string;
};

type PlaylistItem = {
  videoId: string;
  position: number;
  fallbackTitle: string;
  fallbackArtist: string;
  fallbackThumbUrl: string | null;
};

type VideoDetails = {
  videoId: string;
  title: string;
  artist: string;
  durationSeconds: number | null;
  coverUrl: string | null;
  artistChannelId: string | null;
};

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

function chunkArray<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }
  return chunks;
}

function pickBestThumbnailUrl(thumbnails: any): string | null {
  return (
    normalizeNullableString(thumbnails?.high?.url) ||
    normalizeNullableString(thumbnails?.medium?.url) ||
    normalizeNullableString(thumbnails?.default?.url)
  );
}

function parseIso8601DurationSeconds(value: unknown): number | null {
  const raw = normalizeString(value);
  if (!raw) return null;

  // Expected: PT#H#M#S (hours/minutes/seconds are optional)
  const match = raw.match(/^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/);
  if (!match) return null;

  const hours = match[1] ? Number.parseInt(match[1], 10) : 0;
  const minutes = match[2] ? Number.parseInt(match[2], 10) : 0;
  const seconds = match[3] ? Number.parseInt(match[3], 10) : 0;

  if (![hours, minutes, seconds].every((n) => Number.isFinite(n))) return null;

  return Math.max(0, hours * 3600 + minutes * 60 + seconds);
}

async function fetchPlaylistItemsAll(youtubePlaylistId: string): Promise<PlaylistItem[] | null> {
  const apiKey = getApiKey();
  if (!apiKey) return null;

  const playlistId = normalizeString(youtubePlaylistId);
  if (!playlistId) return null;

  const out: PlaylistItem[] = [];
  let pageToken: string | null = null;

  for (let pageNumber = 1; pageNumber <= MAX_PLAYLIST_PAGES; pageNumber += 1) {
    const url = new URL(`${YOUTUBE_API_BASE}/playlistItems`);
    url.searchParams.set("key", apiKey);
    url.searchParams.set("playlistId", playlistId);
    url.searchParams.set("part", "contentDetails,snippet");
    url.searchParams.set(
      "fields",
      "items(contentDetails/videoId,snippet(title,channelId,channelTitle,thumbnails(default(url),medium(url),high(url)),position)),nextPageToken"
    );
    url.searchParams.set("maxResults", String(YOUTUBE_PAGE_SIZE));
    if (pageToken) url.searchParams.set("pageToken", pageToken);

    let status: "ok" | "error" = "ok";
    let errorCode: string | null = null;
    let errorMessage: string | null = null;

    try {
      const response = await fetch(url.toString(), { method: "GET" });
      if (!response.ok) {
        status = "error";
        errorCode = String(response.status);
        errorMessage = "YouTube playlistItems.list failed";
        return null;
      }

      const json = await response.json().catch(() => null);
      if (!json || typeof json !== "object") {
        status = "error";
        errorMessage = "YouTube playlistItems.list failed";
        return null;
      }

      const items = Array.isArray((json as any).items) ? (json as any).items : [];
      for (const item of items) {
        const videoId = normalizeString(item?.contentDetails?.videoId);
        const snippet = item?.snippet;
        const title = normalizeString(snippet?.title);

        if (!videoId) continue;
        if (!title) continue;
        if (title === "Private video" || title === "Deleted video") continue;

        out.push({
          videoId,
          position: typeof snippet?.position === "number" ? snippet.position : out.length,
          fallbackTitle: title,
          fallbackArtist: normalizeString(snippet?.channelTitle) || "Unknown Artist",
          fallbackThumbUrl: pickBestThumbnailUrl(snippet?.thumbnails),
        });
      }

      pageToken = normalizeNullableString((json as any)?.nextPageToken);
      if (!pageToken) break;
    } catch (err: any) {
      status = "error";
      errorMessage = err?.message ? String(err.message) : "YouTube playlistItems.list failed";
      return null;
    } finally {
      void logApiUsage({
        apiKeyOrIdentifier: apiKey,
        endpoint: "youtube.playlistItems.list",
        quotaCost: QUOTA_COST_PLAYLIST_ITEMS_LIST,
        status,
        errorCode,
        errorMessage,
      });
    }
  }

  out.sort((a, b) => a.position - b.position);
  return out;
}

async function fetchVideosDetails(videoIds: string[]): Promise<Map<string, VideoDetails> | null> {
  const apiKey = getApiKey();
  if (!apiKey) return null;

  const uniqueIds = Array.from(new Set(videoIds.map((id) => normalizeString(id)).filter(Boolean)));
  if (uniqueIds.length === 0) return new Map();

  const out = new Map<string, VideoDetails>();

  for (const batch of chunkArray(uniqueIds, VIDEO_BATCH_SIZE)) {
    const url = new URL(`${YOUTUBE_API_BASE}/videos`);
    url.searchParams.set("key", apiKey);
    url.searchParams.set("part", "snippet,contentDetails");
    url.searchParams.set("id", batch.join(","));
    url.searchParams.set(
      "fields",
      "items(id,snippet(title,channelId,channelTitle,thumbnails(default(url),medium(url),high(url))),contentDetails(duration))"
    );
    url.searchParams.set("maxResults", String(batch.length));

    let status: "ok" | "error" = "ok";
    let errorCode: string | null = null;
    let errorMessage: string | null = null;

    try {
      const response = await fetch(url.toString(), { method: "GET" });
      if (!response.ok) {
        status = "error";
        errorCode = String(response.status);
        errorMessage = "YouTube videos.list failed";
        return null;
      }

      const json = await response.json().catch(() => null);
      if (!json || typeof json !== "object") {
        status = "error";
        errorMessage = "YouTube videos.list failed";
        return null;
      }

      const items = Array.isArray((json as any).items) ? (json as any).items : [];
      for (const item of items) {
        const videoId = normalizeString(item?.id);
        const snippet = item?.snippet;
        if (!videoId || !snippet) continue;

        const title = normalizeString(snippet?.title) || "Untitled track";
        const artist = normalizeString(snippet?.channelTitle) || "Unknown Artist";
        const coverUrl = pickBestThumbnailUrl(snippet?.thumbnails);
        const artistChannelId = normalizeNullableString(snippet?.channelId);
        const durationSeconds = parseIso8601DurationSeconds(item?.contentDetails?.duration);

        out.set(videoId, {
          videoId,
          title,
          artist,
          durationSeconds,
          coverUrl,
          artistChannelId,
        });
      }
    } catch (err: any) {
      status = "error";
      errorMessage = err?.message ? String(err.message) : "YouTube videos.list failed";
      return null;
    } finally {
      void logApiUsage({
        apiKeyOrIdentifier: apiKey,
        endpoint: "youtube.videos.list",
        quotaCost: QUOTA_COST_VIDEOS_LIST,
        status,
        errorCode,
        errorMessage,
      });
    }
  }

  return out;
}

async function upsertTracks(records: any[]): Promise<boolean> {
  if (!supabase) return false;
  if (records.length === 0) return true;

  for (const chunk of chunkArray(records, TRACK_UPSERT_CHUNK_SIZE)) {
    const { error } = await supabase.from("tracks").upsert(chunk, { onConflict: "external_id" });
    if (error) {
      const msg = error.message || String(error);

      // If the database doesn't have artist_channel_id, retry once without it.
      if (msg.includes("artist_channel_id") && msg.toLowerCase().includes("does not exist")) {
        const fallbackChunk = chunk.map(({ artist_channel_id, ...rest }) => rest);
        const { error: retryError } = await supabase.from("tracks").upsert(fallbackChunk, { onConflict: "external_id" });
        if (retryError) {
          console.error("[youtubeFetchPlaylistTracks] tracks upsert failed:", retryError);
          return false;
        }
        continue;
      }

      console.error("[youtubeFetchPlaylistTracks] tracks upsert failed:", error);
      return false;
    }
  }

  return true;
}

async function loadTrackIdsByExternalId(externalIds: string[]): Promise<Map<string, string> | null> {
  if (!supabase) return null;

  const ids = Array.from(new Set(externalIds.map((x) => normalizeString(x)).filter(Boolean)));
  const out = new Map<string, string>();

  for (const chunk of chunkArray(ids, 200)) {
    const { data, error } = await supabase.from("tracks").select("id, external_id").in("external_id", chunk);
    if (error) {
      console.error("[youtubeFetchPlaylistTracks] select tracks failed:", error);
      return null;
    }

    for (const row of (data as any[]) || []) {
      const id = normalizeString(row?.id);
      const external_id = normalizeString(row?.external_id);
      if (id && external_id) out.set(external_id, id);
    }
  }

  return out;
}

/**
 * Fetches playlist items + video details from YouTube and writes tracks + playlist_tracks.
 *
 * Constraints:
 * - Batch requests (videos.list batched by 50 IDs)
 * - Avoid duplicates (upsert tracks on external_id, replace playlist_tracks for playlist)
 * - Production-safe (never throws; returns null on failure)
 */
export async function youtubeFetchPlaylistTracks(input: YoutubeFetchPlaylistTracksInput): Promise<{ trackCount: number; playlistTrackCount: number } | null> {
  try {
    if (!supabase) return null;

    const playlist_id = normalizeString(input.playlist_id);
    const youtube_playlist_id = normalizeString(input.youtube_playlist_id);
    if (!playlist_id || !youtube_playlist_id) return null;

    const playlistItems = await fetchPlaylistItemsAll(youtube_playlist_id);
    if (!playlistItems) return null;
    if (playlistItems.length === 0) {
      return { trackCount: 0, playlistTrackCount: 0 };
    }

    const videoIds = playlistItems.map((i) => i.videoId);
    const videoDetailsMap = await fetchVideosDetails(videoIds);
    if (!videoDetailsMap) return null;

    const trackRecords = playlistItems.map((item) => {
      const details = videoDetailsMap.get(item.videoId);
      const title = details?.title || item.fallbackTitle || "Untitled track";
      const artist = details?.artist || item.fallbackArtist || "Unknown Artist";
      const duration = typeof details?.durationSeconds === "number" ? details.durationSeconds : null;
      const cover_url = details?.coverUrl ?? item.fallbackThumbUrl ?? null;
      const artist_channel_id = details?.artistChannelId ?? null;

      return {
        youtube_id: item.videoId,
        external_id: item.videoId,
        title,
        artist,
        duration,
        cover_url,
        artist_channel_id,
      };
    });

    const uniqueTrackMap = new Map<string, any>();
    for (const rec of trackRecords) {
      const external_id = normalizeString(rec.external_id);
      if (!external_id) continue;
      if (!uniqueTrackMap.has(external_id)) uniqueTrackMap.set(external_id, rec);
    }

    const trackUpsertOk = await upsertTracks(Array.from(uniqueTrackMap.values()));
    if (!trackUpsertOk) return null;

    const trackIdMap = await loadTrackIdsByExternalId(videoIds);
    if (!trackIdMap) return null;

    const { error: deleteError } = await supabase.from("playlist_tracks").delete().eq("playlist_id", playlist_id);
    if (deleteError) {
      console.error("[youtubeFetchPlaylistTracks] delete playlist_tracks failed:", deleteError);
      return null;
    }

    const linkRowsRaw: Array<{ playlist_id: string; track_id: string; position: number }> = [];
    playlistItems.forEach((item, idx) => {
      const trackId = trackIdMap.get(item.videoId);
      if (!trackId) return;
      const position = typeof item.position === "number" ? item.position + 1 : idx + 1;
      linkRowsRaw.push({ playlist_id, track_id: trackId, position });
    });

    const linkDedupe = new Map<string, { playlist_id: string; track_id: string; position: number }>();
    for (const row of linkRowsRaw) {
      const key = `${row.playlist_id}::${row.track_id}`;
      const existing = linkDedupe.get(key);
      if (!existing || row.position < existing.position) {
        linkDedupe.set(key, row);
      }
    }

    const linkRows = Array.from(linkDedupe.values()).sort((a, b) => a.position - b.position);

    for (const chunk of chunkArray(linkRows, PLAYLIST_TRACKS_CHUNK_SIZE)) {
      const { error } = await supabase.from("playlist_tracks").insert(chunk);
      if (error) {
        console.error("[youtubeFetchPlaylistTracks] insert playlist_tracks failed:", error);
        return null;
      }
    }

    return {
      trackCount: uniqueTrackMap.size,
      playlistTrackCount: linkRows.length,
    };
  } catch (err) {
    console.error("[youtubeFetchPlaylistTracks] unexpected error:", err);
    return null;
  }
}
