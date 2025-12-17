import supabase from "./supabaseClient";
import { logApiUsage } from "./apiUsageLogger";

const YOUTUBE_API_BASE = "https://www.googleapis.com/youtube/v3";
const QUOTA_COST_PLAYLIST_ITEMS_LIST = 1;
const QUOTA_COST_VIDEOS_LIST = 1;

const YOUTUBE_PAGE_SIZE = 50;
const VIDEO_BATCH_SIZE = 50;
const INSERT_CHUNK_SIZE = 200;

export type YoutubeFetchPlaylistTracksInput = {
  playlist_id: string;
  external_playlist_id: string;
  if_none_match?: string | null;
  // Optional: limit how many tracks we ingest from this playlist.
  // Used by the Search resolve "delta ingestion" flow.
  max_tracks?: number;
  // Optional: force the stored track artist to a specific name.
  // Used to ensure tracks are saved under the search artistName.
  artist_override?: string;
  // Optional: force the stored artist_channel_id to a specific channel id.
  // Used to ensure tracks from Topic/VEVO uploads appear under the primary artist channel page.
  artist_channel_id_override?: string;
};

type PlaylistItem = {
  videoId: string;
  position: number;
};

type VideoRow = {
  external_id: string;
  youtube_id: string;
  title: string;
  artist: string;
  duration: number | null;
  cover_url: string | null;
  artist_channel_id: string | null;
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

  const match = raw.match(/^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/);
  if (!match) return null;

  const hours = match[1] ? Number.parseInt(match[1], 10) : 0;
  const minutes = match[2] ? Number.parseInt(match[2], 10) : 0;
  const seconds = match[3] ? Number.parseInt(match[3], 10) : 0;

  if (![hours, minutes, seconds].every((n) => Number.isFinite(n))) return null;
  return Math.max(0, hours * 3600 + minutes * 60 + seconds);
}

async function fetchPlaylistItemsAll(
  external_playlist_id: string,
  ifNoneMatch?: string | null
): Promise<{ state: 'unchanged'; etag: string | null } | { state: 'fetched'; etag: string | null; items: PlaylistItem[] } | null> {
  const apiKey = getApiKey();
  if (!apiKey) return null;

  const playlistId = normalizeString(external_playlist_id);
  if (!playlistId) return null;

  const out: PlaylistItem[] = [];
  let pageToken: string | null = null;
  let currentPage = 1;
  let etagToSend: string | null = normalizeNullableString(ifNoneMatch);
  let finalEtag: string | null = etagToSend;

  while (true) {
    const url = new URL(`${YOUTUBE_API_BASE}/playlistItems`);
    url.searchParams.set("key", apiKey);
    url.searchParams.set("playlistId", playlistId);
    url.searchParams.set("part", "snippet,contentDetails");
    url.searchParams.set("maxResults", String(YOUTUBE_PAGE_SIZE));
    url.searchParams.set(
      "fields",
      "items(contentDetails/videoId,snippet(position,title)),nextPageToken"
    );
    if (pageToken) url.searchParams.set("pageToken", pageToken);

    const headers: Record<string, string> = {
      'Accept-Encoding': 'gzip',
    };
    if (etagToSend) headers['If-None-Match'] = etagToSend;

    let status: "ok" | "error" = "ok";
    let errorCode: string | null = null;
    let errorMessage: string | null = null;
    let quotaCost = QUOTA_COST_PLAYLIST_ITEMS_LIST;

    try {
      const response = await fetch(url.toString(), { method: "GET", headers });

      const quotaHeader = response.headers.get('x-goog-quota-used');
      if (quotaHeader) {
        const parsed = Number.parseFloat(quotaHeader);
        if (Number.isFinite(parsed) && parsed >= 0) quotaCost = parsed;
      }

      const headerEtag = normalizeNullableString(response.headers.get('etag'));
      if (headerEtag) finalEtag = headerEtag;

      if (response.status === 304) {
        // If the first page is unchanged, treat the whole playlist as unchanged.
        if (currentPage === 1) {
          return { state: 'unchanged', etag: finalEtag };
        }
        break;
      }

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

      const bodyEtag = normalizeNullableString((json as any)?.etag);
      if (bodyEtag) finalEtag = bodyEtag;

      const items = Array.isArray((json as any).items) ? (json as any).items : [];
      for (const item of items) {
        const videoId = normalizeString(item?.contentDetails?.videoId);
        const position = typeof item?.snippet?.position === "number" ? item.snippet.position : out.length;
        const title = normalizeString(item?.snippet?.title);

        if (!videoId) continue;
        if (title === "Private video" || title === "Deleted video") continue;

        out.push({ videoId, position });
      }

      pageToken = normalizeNullableString((json as any)?.nextPageToken);
      if (!pageToken) break;

      etagToSend = finalEtag;
      currentPage += 1;
    } catch (err: any) {
      status = "error";
      errorMessage = err?.message ? String(err.message) : "YouTube playlistItems.list failed";
      return null;
    } finally {
      void logApiUsage({
        apiKeyOrIdentifier: apiKey,
        endpoint: "youtube.playlistItems.list",
        quotaCost,
        status,
        errorCode,
        errorMessage,
      });
    }
  }

  out.sort((a, b) => a.position - b.position);
  return { state: 'fetched', etag: finalEtag, items: out };
}

async function fetchVideosDetails(videoIds: string[]): Promise<Map<string, VideoRow> | null> {
  const apiKey = getApiKey();
  if (!apiKey) return null;

  const uniqueIds = Array.from(new Set(videoIds.map((id) => normalizeString(id)).filter(Boolean)));
  const out = new Map<string, VideoRow>();

  for (const batch of chunkArray(uniqueIds, VIDEO_BATCH_SIZE)) {
    const url = new URL(`${YOUTUBE_API_BASE}/videos`);
    url.searchParams.set("key", apiKey);
    url.searchParams.set("part", "snippet,contentDetails,statistics");
    url.searchParams.set("id", batch.join(","));
    url.searchParams.set(
      "fields",
      "items(id,snippet(title,channelId,channelTitle,thumbnails(default(url),medium(url),high(url))),contentDetails(duration),statistics(viewCount))"
    );

    let status: "ok" | "error" = "ok";
    let errorCode: string | null = null;
    let errorMessage: string | null = null;
    let quotaCost = QUOTA_COST_VIDEOS_LIST;

    try {
      const response = await fetch(url.toString(), { method: "GET" });

      const quotaHeader = response.headers.get('x-goog-quota-used');
      if (quotaHeader) {
        const parsed = Number.parseFloat(quotaHeader);
        if (Number.isFinite(parsed) && parsed >= 0) quotaCost = parsed;
      }

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
        const youtube_id = normalizeString(item?.id);
        const snippet = item?.snippet;
        if (!youtube_id || !snippet) continue;

        out.set(youtube_id, {
          external_id: youtube_id,
          youtube_id,
          title: normalizeString(snippet?.title) || "Untitled",
          artist: normalizeString(snippet?.channelTitle) || "Unknown Artist",
          duration: parseIso8601DurationSeconds(item?.contentDetails?.duration),
          cover_url: pickBestThumbnailUrl(snippet?.thumbnails),
          artist_channel_id: normalizeNullableString(snippet?.channelId),
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
        quotaCost,
        status,
        errorCode,
        errorMessage,
      });
    }
  }

  return out;
}

async function loadExistingTracksByExternalId(externalIds: string[]): Promise<Map<string, string> | null> {
  if (!supabase) return null;

  const out = new Map<string, string>();
  for (const chunk of chunkArray(externalIds, 200)) {
    const { data, error } = await supabase.from("tracks").select("id, external_id").in("external_id", chunk);
    if (error) return null;
    for (const row of (data as any[]) || []) {
      const id = normalizeString(row?.id);
      const external_id = normalizeString(row?.external_id);
      if (id && external_id) out.set(external_id, id);
    }
  }
  return out;
}

async function loadExistingPlaylistTrackIds(playlist_id: string, trackIds: string[]): Promise<Set<string> | null> {
  if (!supabase) return null;

  const out = new Set<string>();
  for (const chunk of chunkArray(trackIds, 200)) {
    const { data, error } = await supabase
      .from("playlist_tracks")
      .select("track_id")
      .eq("playlist_id", playlist_id)
      .in("track_id", chunk);
    if (error) return null;
    for (const row of (data as any[]) || []) {
      const track_id = normalizeString(row?.track_id);
      if (track_id) out.add(track_id);
    }
  }
  return out;
}

/**
 * Canonical playlist track ingestion.
 *
 * - Calls playlistItems.list (paginated) and videos.list (batched)
 * - Upserts tracks (unique by external_id)
 * - Inserts missing playlist_tracks (after checking existing (playlist_id, track_id))
 * - Never throws: returns null on any failure
 */
export async function youtubeFetchPlaylistTracks(input: YoutubeFetchPlaylistTracksInput): Promise<number | null> {
  try {
    if (!supabase) return null;

    const playlist_id = normalizeString(input.playlist_id);
    const external_playlist_id = normalizeString(input.external_playlist_id);
    if (!playlist_id || !external_playlist_id) return null;

    const playlistItemsResult = await fetchPlaylistItemsAll(external_playlist_id, input.if_none_match ?? null);
    if (!playlistItemsResult) return null;

    // Best-effort: persist ETag/refresh timestamp on the playlist row when available.
    if (playlistItemsResult.etag) {
      const now = new Date().toISOString();
      const { error: updateError } = await supabase
        .from('playlists')
        .update({ last_etag: playlistItemsResult.etag, last_refreshed_on: now })
        .eq('id', playlist_id);
      if (updateError) {
        // Non-fatal; some environments may not expose these columns.
        void updateError;
      }
    }

    if (playlistItemsResult.state === 'unchanged') {
      return 0;
    }

    let playlistItems = playlistItemsResult.items;
    const maxTracksRaw = input.max_tracks;
    const maxTracks = typeof maxTracksRaw === "number" && Number.isFinite(maxTracksRaw) ? Math.max(0, Math.trunc(maxTracksRaw)) : null;
    if (maxTracks !== null) {
      if (maxTracks === 0) return 0;
      playlistItems = playlistItems.slice(0, maxTracks);
    }
    if (playlistItems.length === 0) return 0;

    const videoIds = playlistItems.map((i) => i.videoId);
    const videoDetailsMap = await fetchVideosDetails(videoIds);
    if (!videoDetailsMap) return null;

    const desiredTrackRowsMap = new Map<string, VideoRow>();
    for (const item of playlistItems) {
      const row = videoDetailsMap.get(item.videoId);
      if (!row) continue;
      if (desiredTrackRowsMap.has(row.external_id)) continue;

      const override = typeof input.artist_override === "string" ? input.artist_override.trim() : "";
      const channelOverride = typeof input.artist_channel_id_override === "string" ? input.artist_channel_id_override.trim() : "";
      if (override || channelOverride) {
        desiredTrackRowsMap.set(row.external_id, {
          ...row,
          artist: override ? override : row.artist,
          artist_channel_id: channelOverride ? channelOverride : row.artist_channel_id,
        });
      } else {
        desiredTrackRowsMap.set(row.external_id, row);
      }
    }
    const desiredTrackRows = Array.from(desiredTrackRowsMap.values());
    if (desiredTrackRows.length === 0) return 0;

    const existingTrackIdMap = await loadExistingTracksByExternalId(desiredTrackRows.map((r) => r.external_id));
    if (!existingTrackIdMap) return null;

    const newTrackRows = desiredTrackRows.filter((r) => !existingTrackIdMap.has(r.external_id));
    let insertedTracksCount = 0;

    if (newTrackRows.length > 0) {
      for (const chunk of chunkArray(newTrackRows, INSERT_CHUNK_SIZE)) {
        const { error } = await supabase.from("tracks").upsert(chunk, { onConflict: "external_id" });
        if (error) {
          console.error("[youtubeFetchPlaylistTracks] upsert tracks failed:", error);
          return null;
        }
        insertedTracksCount += chunk.length;
      }
    }

    const trackIdMap = await loadExistingTracksByExternalId(desiredTrackRows.map((r) => r.external_id));
    if (!trackIdMap) return null;

    const desiredLinksRaw: Array<{ playlist_id: string; track_id: string; position: number }> = [];
    playlistItems.forEach((item, idx) => {
      const trackId = trackIdMap.get(item.videoId);
      if (!trackId) return;
      const position = (Number.isFinite(item.position) ? item.position : idx) + 1;
      desiredLinksRaw.push({ playlist_id, track_id: trackId, position });
    });

    const linkDedupe = new Map<string, { playlist_id: string; track_id: string; position: number }>();
    for (const row of desiredLinksRaw) {
      const existing = linkDedupe.get(row.track_id);
      if (!existing || row.position < existing.position) linkDedupe.set(row.track_id, row);
    }
    const desiredLinks = Array.from(linkDedupe.values()).sort((a, b) => a.position - b.position);
    if (desiredLinks.length === 0) return insertedTracksCount;

    const existingPlaylistTrackIds = await loadExistingPlaylistTrackIds(
      playlist_id,
      desiredLinks.map((r) => r.track_id)
    );
    if (!existingPlaylistTrackIds) return null;

    const newLinks = desiredLinks.filter((r) => !existingPlaylistTrackIds.has(r.track_id));
    if (newLinks.length === 0) return insertedTracksCount;

    for (const chunk of chunkArray(newLinks, INSERT_CHUNK_SIZE)) {
      const { error } = await supabase.from("playlist_tracks").insert(chunk);
      if (error) {
        console.error("[youtubeFetchPlaylistTracks] insert playlist_tracks failed:", error);
        return null;
      }
    }

    return insertedTracksCount;
  } catch (err) {
    console.error("[youtubeFetchPlaylistTracks] unexpected error:", err);
    return null;
  }
}
