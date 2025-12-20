import supabase from "./supabaseClient";
import { logApiUsage } from "./apiUsageLogger";
import { youtubeScrapePlaylistVideoIds } from "./youtubeScrapePlaylistVideoIds";

const YOUTUBE_API_BASE = "https://www.googleapis.com/youtube/v3";
const QUOTA_COST_PLAYLIST_ITEMS_LIST = 1;
const QUOTA_COST_VIDEOS_LIST = 1;

const YOUTUBE_PAGE_SIZE = 50;
const VIDEO_BATCH_SIZE = 50;
const INSERT_CHUNK_SIZE = 200;

const LOG_PREFIX = "[youtubeFetchPlaylistTracks]";

export type YoutubeFetchPlaylistTracksInput = {
  playlist_id: string;
  external_playlist_id: string;
  if_none_match?: string | null;
  // Optional: fully replace playlist_tracks for this playlist.
  // Useful for refresh to reflect deletions/reordering.
  replace_existing?: boolean;
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

type YoutubeApiErrorInfo = {
  code?: number;
  status?: string;
  message?: string;
  reason?: string;
  errorsCount?: number;
};

function extractYoutubeApiErrorInfo(json: any): YoutubeApiErrorInfo | null {
  if (!json || typeof json !== "object") return null;
  const err = (json as any)?.error;
  if (!err || typeof err !== "object") return null;

  const firstError = Array.isArray(err?.errors) ? err.errors[0] : null;
  const info: YoutubeApiErrorInfo = {
    code: typeof err?.code === "number" ? err.code : undefined,
    status: typeof err?.status === "string" ? err.status : undefined,
    message: typeof err?.message === "string" ? err.message : undefined,
    reason: typeof firstError?.reason === "string" ? firstError.reason : undefined,
    errorsCount: Array.isArray(err?.errors) ? err.errors.length : undefined,
  };

  const hasAny = Object.values(info).some((v) => v !== undefined);
  return hasAny ? info : null;
}

async function safeReadJson(response: Response): Promise<any | null> {
  try {
    return await response.json();
  } catch {
    return null;
  }
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
  if (!apiKey) {
    console.warn(`${LOG_PREFIX} playlistItems.list skipped: missing YOUTUBE_API_KEY`, {
      external_playlist_id: normalizeString(external_playlist_id),
    });
    return null;
  }

  const playlistId = normalizeString(external_playlist_id);
  if (!playlistId) return null;

  const out: PlaylistItem[] = [];
  let pageToken: string | null = null;
  let currentPage = 1;
  let etagToSend: string | null = normalizeNullableString(ifNoneMatch);
  let finalEtag: string | null = etagToSend;

  let rawItemsCount = 0;
  let skippedItemsCount = 0;

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

        const body = await safeReadJson(response);
        const info = extractYoutubeApiErrorInfo(body);
        console.warn(`${LOG_PREFIX} playlistItems.list http_error`, {
          playlistId,
          page: currentPage,
          status: response.status,
          error: info,
        });
        return null;
      }

      const json = await safeReadJson(response);
      if (!json || typeof json !== "object") {
        status = "error";
        errorMessage = "YouTube playlistItems.list failed";
        console.warn(`${LOG_PREFIX} playlistItems.list invalid_json`, {
          playlistId,
          page: currentPage,
        });
        return null;
      }

      const bodyEtag = normalizeNullableString((json as any)?.etag);
      if (bodyEtag) finalEtag = bodyEtag;

      const items = Array.isArray((json as any).items) ? (json as any).items : [];
      rawItemsCount += items.length;
      for (const item of items) {
        const videoId = normalizeString(item?.contentDetails?.videoId);
        const position = typeof item?.snippet?.position === "number" ? item.snippet.position : out.length;
        const title = normalizeString(item?.snippet?.title);

        if (!videoId) continue;
        if (title === "Private video" || title === "Deleted video") {
          skippedItemsCount += 1;
          continue;
        }

        out.push({ videoId, position });
      }

      pageToken = normalizeNullableString((json as any)?.nextPageToken);
      if (!pageToken) break;

      etagToSend = finalEtag;
      currentPage += 1;
    } catch (err: any) {
      status = "error";
      errorMessage = err?.message ? String(err.message) : "YouTube playlistItems.list failed";
      console.warn(`${LOG_PREFIX} playlistItems.list exception`, {
        playlistId,
        page: currentPage,
        message: errorMessage,
      });
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
  console.info(`${LOG_PREFIX} playlistItems.list done`, {
    playlistId,
    pages: currentPage,
    items_raw: rawItemsCount,
    items_kept: out.length,
    items_skipped_private_or_deleted: skippedItemsCount,
    etag: finalEtag,
  });
  return { state: 'fetched', etag: finalEtag, items: out };
}

async function fetchVideosDetails(videoIds: string[]): Promise<Map<string, VideoRow> | null> {
  const apiKey = getApiKey();
  if (!apiKey) {
    console.warn(`${LOG_PREFIX} videos.list skipped: missing YOUTUBE_API_KEY`, {
      requested_ids: videoIds.length,
    });
    return null;
  }

  const uniqueIds = Array.from(new Set(videoIds.map((id) => normalizeString(id)).filter(Boolean)));
  const out = new Map<string, VideoRow>();

  let totalRequested = 0;
  let totalReturned = 0;

  for (const batch of chunkArray(uniqueIds, VIDEO_BATCH_SIZE)) {
    totalRequested += batch.length;
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

        const body = await safeReadJson(response);
        const info = extractYoutubeApiErrorInfo(body);
        console.warn(`${LOG_PREFIX} videos.list http_error`, {
          status: response.status,
          requested: batch.length,
          error: info,
        });
        return null;
      }

      const json = await safeReadJson(response);
      if (!json || typeof json !== "object") {
        status = "error";
        errorMessage = "YouTube videos.list failed";
        console.warn(`${LOG_PREFIX} videos.list invalid_json`, {
          requested: batch.length,
        });
        return null;
      }

      const items = Array.isArray((json as any).items) ? (json as any).items : [];
      totalReturned += items.length;
      const missing = Math.max(0, batch.length - items.length);
      if (missing > 0) {
        console.info(`${LOG_PREFIX} videos.list partial`, {
          requested: batch.length,
          returned: items.length,
          missing,
        });
      }
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
      console.warn(`${LOG_PREFIX} videos.list exception`, {
        requested: batch.length,
        message: errorMessage,
      });
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

  console.info(`${LOG_PREFIX} videos.list done`, {
    requested_unique: uniqueIds.length,
    requested_total: totalRequested,
    returned_total: totalReturned,
    returned_unique: out.size,
  });
  return out;
}

async function loadExistingTracksByExternalId(externalIds: string[]): Promise<Map<string, string> | null> {
  if (!supabase) return null;

  const out = new Map<string, string>();
  for (const chunk of chunkArray(externalIds, 200)) {
    const { data, error } = await supabase.from("tracks").select("id, external_id").in("external_id", chunk);
    if (error) {
      console.warn(`${LOG_PREFIX} supabase_select_tracks_failed`, {
        code: (error as any)?.code,
        message: (error as any)?.message,
        chunkSize: chunk.length,
      });
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

async function loadExistingPlaylistTrackIds(playlist_id: string, trackIds: string[]): Promise<Set<string> | null> {
  if (!supabase) return null;

  const out = new Set<string>();
  for (const chunk of chunkArray(trackIds, 200)) {
    const { data, error } = await supabase
      .from("playlist_tracks")
      .select("track_id")
      .eq("playlist_id", playlist_id)
      .in("track_id", chunk);
    if (error) {
      console.warn(`${LOG_PREFIX} supabase_select_playlist_tracks_failed`, {
        code: (error as any)?.code,
        message: (error as any)?.message,
        playlist_id,
        chunkSize: chunk.length,
      });
      return null;
    }
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
  const startedAt = Date.now();
  const playlist_id_for_log = normalizeString(input.playlist_id);
  const external_playlist_id_for_log = normalizeString(input.external_playlist_id);

  console.info(`${LOG_PREFIX} START`, {
    playlist_id: playlist_id_for_log,
    external_playlist_id: external_playlist_id_for_log,
    replace_existing: Boolean(input.replace_existing),
    max_tracks: typeof input.max_tracks === "number" ? input.max_tracks : null,
    has_if_none_match: Boolean(normalizeNullableString(input.if_none_match)),
    has_artist_override: Boolean(normalizeString(input.artist_override)),
    has_artist_channel_id_override: Boolean(normalizeString(input.artist_channel_id_override)),
  });

  try {
    if (!supabase) return null;

    const playlist_id = normalizeString(input.playlist_id);
    const external_playlist_id = normalizeString(input.external_playlist_id);
    if (!playlist_id || !external_playlist_id) return null;

    let usedScrapeFallback = false;

    let playlistItemsResult = await fetchPlaylistItemsAll(external_playlist_id, input.if_none_match ?? null);
    if (!playlistItemsResult) {
      // Some Topic auto-generated album playlists (OLAK5uy...) can intermittently fail playlistItems.list.
      // Fallback: scrape the playlist page and continue.
      if (external_playlist_id.startsWith("OLAK5uy")) {
        const scraped = await youtubeScrapePlaylistVideoIds(external_playlist_id, { max: input.max_tracks ?? null });
        if (scraped.length === 0) return null;

        usedScrapeFallback = true;
        console.info(`${LOG_PREFIX} playlistItems.list failed; using scrape fallback`, {
          playlist_id,
          external_playlist_id,
          scraped_ids: scraped.length,
        });

        playlistItemsResult = {
          state: 'fetched',
          etag: null,
          items: scraped.map((videoId, idx) => ({ videoId, position: idx })),
        };
      } else {
        console.warn(`${LOG_PREFIX} playlistItems.list failed; no fallback`, {
          playlist_id,
          external_playlist_id,
        });
        return null;
      }
    }

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
      console.info(`${LOG_PREFIX} DONE unchanged`, {
        playlist_id,
        external_playlist_id,
        durationMs: Date.now() - startedAt,
        etag: playlistItemsResult.etag,
        usedScrapeFallback,
      });
      return 0;
    }

    let playlistItems = playlistItemsResult.items;
    const playlistItemsFetchedCount = playlistItems.length;
    const maxTracksRaw = input.max_tracks;
    const maxTracks = typeof maxTracksRaw === "number" && Number.isFinite(maxTracksRaw) ? Math.max(0, Math.trunc(maxTracksRaw)) : null;
    if (maxTracks !== null) {
      if (maxTracks === 0) return 0;
      playlistItems = playlistItems.slice(0, maxTracks);
    }
    const playlistItemsAfterMaxCount = playlistItems.length;
    if (playlistItems.length === 0) {
      // Edge case: playlistItems.list can return 0 even for playlists that appear to have videos.
      // Fallback: scrape the playlist page and continue. Keep it bounded to avoid huge scrapes.
      const scrapeMax = maxTracks !== null ? maxTracks : 200;
      const scraped = await youtubeScrapePlaylistVideoIds(external_playlist_id, { max: scrapeMax });
      if (scraped.length === 0) {
        console.info(`${LOG_PREFIX} DONE empty_playlist_items`, {
          playlist_id,
          external_playlist_id,
          durationMs: Date.now() - startedAt,
          etag: playlistItemsResult.etag,
          usedScrapeFallback,
          playlistItemsFetchedCount,
          playlistItemsAfterMaxCount,
          scrapeAttempted: true,
          scrapeMax,
        });
        return 0;
      }

      usedScrapeFallback = true;
      console.info(`${LOG_PREFIX} playlistItems.list returned 0; using scrape fallback`, {
        playlist_id,
        external_playlist_id,
        scraped_ids: scraped.length,
        scrapeMax,
      });
      playlistItems = scraped.map((videoId, idx) => ({ videoId, position: idx }));
    }

    const videoIds = playlistItems.map((i) => i.videoId);
    const videoDetailsMap = await fetchVideosDetails(videoIds);
    if (!videoDetailsMap) {
      console.warn(`${LOG_PREFIX} DONE videos_details_failed`, {
        playlist_id,
        external_playlist_id,
        durationMs: Date.now() - startedAt,
        requested_video_ids: videoIds.length,
      });
      return null;
    }

    const missingVideoDetailsCount = Math.max(0, videoIds.length - videoDetailsMap.size);
    if (missingVideoDetailsCount > 0) {
      console.info(`${LOG_PREFIX} missing_video_details`, {
        playlist_id,
        external_playlist_id,
        requested: videoIds.length,
        returned: videoDetailsMap.size,
        missing: missingVideoDetailsCount,
      });
    }

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
    if (desiredTrackRows.length === 0) {
      console.info(`${LOG_PREFIX} DONE no_usable_video_details`, {
        playlist_id,
        external_playlist_id,
        durationMs: Date.now() - startedAt,
        playlistItemsFetchedCount,
        playlistItemsAfterMaxCount,
        requested_video_ids: videoIds.length,
        returned_video_details: videoDetailsMap.size,
        missing_video_details: missingVideoDetailsCount,
        usedScrapeFallback,
      });
      return 0;
    }

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

    const replaceExisting = Boolean(input.replace_existing);
    if (replaceExisting) {
      console.info("[youtubeFetchPlaylistTracks] replace_existing", {
        playlist_id,
        external_playlist_id,
        desired_links: desiredLinks.length,
        inserted_tracks: insertedTracksCount,
      });

      let deletedExisting: number | null = null;
      try {
        const { count, error: countError } = await supabase
          .from("playlist_tracks")
          .select("track_id", { count: "exact", head: true })
          .eq("playlist_id", playlist_id);
        if (!countError && typeof count === "number") deletedExisting = count;
      } catch {
        // ignore
      }

      // Optimization: if the number of playlist tracks didn't change AND we didn't insert any new track rows,
      // skip destructive replace to reduce DB churn.
      if (deletedExisting !== null && desiredLinks.length === deletedExisting && insertedTracksCount === 0) {
        console.log("No changes in playlist data, skipping replace_existing.");
        return 0;
      }

      const { error: deleteError } = await supabase
        .from("playlist_tracks")
        .delete()
        .eq("playlist_id", playlist_id);

      if (deleteError) {
        console.error("[youtubeFetchPlaylistTracks] delete playlist_tracks failed:", deleteError);
        return null;
      }

      for (const chunk of chunkArray(desiredLinks, INSERT_CHUNK_SIZE)) {
        const { error } = await supabase.from("playlist_tracks").insert(chunk);
        if (error) {
          console.error("[youtubeFetchPlaylistTracks] insert playlist_tracks failed:", error);
          return null;
        }
      }

      console.info("[youtubeFetchPlaylistTracks] replace_existing_done", {
        playlist_id,
        external_playlist_id,
        desired_links: desiredLinks.length,
        inserted_tracks: insertedTracksCount,
        deleted_existing: deletedExisting,
      });

      console.info(`${LOG_PREFIX} DONE`, {
        playlist_id,
        external_playlist_id,
        durationMs: Date.now() - startedAt,
        etag: playlistItemsResult.etag,
        usedScrapeFallback,
        playlistItemsFetchedCount,
        playlistItemsAfterMaxCount,
        requested_video_ids: videoIds.length,
        returned_video_details: videoDetailsMap.size,
        missing_video_details: missingVideoDetailsCount,
        desired_track_rows: desiredTrackRows.length,
        new_track_rows: newTrackRows.length,
        inserted_tracks: insertedTracksCount,
        replace_existing: true,
        deleted_existing: deletedExisting,
        inserted_links: desiredLinks.length,
      });
      return insertedTracksCount;
    }

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

    console.info(`${LOG_PREFIX} DONE`, {
      playlist_id,
      external_playlist_id,
      durationMs: Date.now() - startedAt,
      etag: playlistItemsResult.etag,
      usedScrapeFallback,
      playlistItemsFetchedCount,
      playlistItemsAfterMaxCount,
      requested_video_ids: videoIds.length,
      returned_video_details: videoDetailsMap.size,
      missing_video_details: missingVideoDetailsCount,
      desired_track_rows: desiredTrackRows.length,
      new_track_rows: newTrackRows.length,
      inserted_tracks: insertedTracksCount,
      replace_existing: false,
      inserted_links: newLinks.length,
      desired_links: desiredLinks.length,
    });
    return insertedTracksCount;
  } catch (err) {
    console.error("[youtubeFetchPlaylistTracks] unexpected error:", err);
    return null;
  }
}
