import { Router } from "express";
import crypto from "node:crypto";

import supabase from "../services/supabaseClient";
import {
  deleteYoutubeChannelMappingByChannelId,
  deriveArtistKey,
  upsertYoutubeChannelMapping,
  validateYouTubeChannelId,
} from "../services/artistResolver";
import type { IngestEntry } from "../lib/ingestLock";
import { getIngestMap } from "../lib/ingestLock";
import { TtlCache } from "../lib/ttlCache";
import { normalizeArtistKey } from "../utils/artistKey";
import { ingestArtistFromYouTubeByChannelId } from "../services/ingestArtistFromYouTube";
import { youtubeSearchArtistChannel } from "../services/youtubeClient";
import { isOlakPlaylistId } from "../utils/olak";

const router = Router();

const LOG_PREFIX = "[ArtistLocal]";
const MIN_QUERY_CHARS = 2;
const IN_CHUNK = 200;

const ARTIST_MEMORY_CACHE_TTL_MS = 60_000;
const ARTIST_PERSISTED_CACHE_TTL_MS = 10 * 60_000; // 10 minutes
const ARTIST_TRACK_LIMIT = 20;
const ARTIST_PLAYLIST_LIMIT = 20;

const artistResponseCache = new TtlCache<CachedArtistPayload>(ARTIST_MEMORY_CACHE_TTL_MS);
const ARTIST_CACHE_TABLE = "artist_cache_entries";

type CachedArtistPayload = { etag: string; body: OkResponse };

type YoutubeChannelsRow = {
  name: string;
  youtube_channel_id: string;
};

function makeEtagFromBody(body: unknown): string {
  const json = JSON.stringify(body);
  return `"${crypto.createHash("sha1").update(json).digest("hex")}"`;
}

function cacheKeyForIdentifier(identifierRaw: string): string {
  const identifier = normalizeString(identifierRaw);
  if (!identifier) return "";
  const key = deriveArtistKey(identifier);
  return (key || identifier).toLowerCase();
}

type ApiPlaylist = {
  id: string;
  title: string;
  description?: string | null;
  youtube_playlist_id: string;
  cover_url?: string | null;
  youtube_channel_id?: string;
  source?: string;
  created_at?: string | null;
  like_count?: number | null;
  view_count?: number | null;
  public_like_count?: number | null;
  public_view_count?: number | null;
};

type ApiTrack = {
  id: string;
  title: string;
  youtube_video_id: string;
  cover_url?: string | null;
  duration?: number | null;
  youtube_channel_id?: string;
  artist_name?: string | null;
  created_at?: string | null;
};

type ApiArtistMedia = {
  artist_name: string;
  youtube_channel_id: string | null;
  thumbnail_url: string | null;
  banner_url: string | null;
};

type OkResponse = {
  status: "ok";
  artist: ApiArtistMedia;
  playlists: ApiPlaylist[];
  tracks: ApiTrack[];
};

type NotReadyResponse = {
  status: "not_ready";
};

type QueryArtistRequest = {
  artist_key?: unknown;
  artist?: unknown;
};

function normalizeString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeNullableString(value: unknown): string | null {
  const s = normalizeString(value);
  return s ? s : null;
}

function chunkArray<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

async function loadPersistedArtistCache(key: string): Promise<CachedArtistPayload | null> {
  if (!supabase) return null;

  try {
    const { data, error } = await supabase
      .from(ARTIST_CACHE_TABLE)
      .select("payload, etag, ts")
      .eq("artist_key", key)
      .order("ts", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error || !data) return null;

    const ts = data.ts ? new Date(String(data.ts)).getTime() : null;
    if (ts && Date.now() - ts > ARTIST_PERSISTED_CACHE_TTL_MS) return null;

    const body = (data as any)?.payload as OkResponse | null;
    if (!body) return null;

    const etag = typeof (data as any)?.etag === "string" && (data as any).etag ? String((data as any).etag) : makeEtagFromBody(body);
    return { etag, body };
  } catch (err: any) {
    console.warn(LOG_PREFIX, "cache load failed", { key, message: err?.message ? String(err.message) : "unknown" });
    return null;
  }
}

async function persistArtistCache(key: string, payload: CachedArtistPayload): Promise<void> {
  if (!supabase) return;

  try {
    const { error } = await supabase
      .from(ARTIST_CACHE_TABLE)
      .upsert(
        {
          artist_key: key,
          payload: payload.body,
          etag: payload.etag,
          ts: new Date().toISOString(),
        },
        { onConflict: "artist_key" }
      );

    if (error) throw error;
  } catch (err: any) {
    console.warn(LOG_PREFIX, "cache persist failed", { key, message: err?.message ? String(err.message) : "unknown" });
  }
}

async function getCachedArtist(key: string): Promise<CachedArtistPayload | null> {
  const memory = artistResponseCache.get(key);
  if (memory) return memory;

  const persisted = await loadPersistedArtistCache(key);
  if (persisted) {
    artistResponseCache.set(key, persisted);
    return persisted;
  }

  return null;
}

async function isCachedPayloadFresh(payload: CachedArtistPayload): Promise<boolean> {
  if (!supabase) return true;
  const playlistIds = Array.isArray(payload.body?.playlists)
    ? payload.body.playlists.map((p) => normalizeString((p as any)?.id)).filter(Boolean)
    : [];
  if (playlistIds.length === 0) return true;

  try {
    const { count, error } = await supabase
      .from("playlists")
      .select("id", { head: true, count: "exact" })
      .in("id", playlistIds as any);

    if (error) {
      console.warn(LOG_PREFIX, "cache freshness check failed", { code: error.code, message: error.message });
      return false;
    }

    const found = typeof count === "number" ? count : 0;
    return found === playlistIds.length;
  } catch (err: any) {
    console.warn(LOG_PREFIX, "cache freshness unexpected error", { message: err?.message ? String(err.message) : "unknown" });
    return false;
  }
}

async function findYoutubeChannelByArtistNameExact(artistName: string): Promise<YoutubeChannelsRow | null> {
  if (!supabase) return null;

  const name = normalizeString(artistName).toLowerCase();
  if (name.length < MIN_QUERY_CHARS) return null;

  const { data, error } = await supabase
    .from("youtube_channels")
    .select("name, youtube_channel_id")
    // ilike without wildcards behaves like case-insensitive equality.
    .ilike("name", name)
    .limit(1)
    .maybeSingle();

  if (error) {
    console.warn(LOG_PREFIX, "cache lookup failed", { artistName: name, code: error.code, message: error.message });
    return null;
  }

  const outId = typeof (data as any)?.youtube_channel_id === "string" ? String((data as any).youtube_channel_id).trim() : "";
  const outName = typeof (data as any)?.name === "string" ? String((data as any).name).trim() : "";
  if (!outId) return null;

  return { name: outName || name, youtube_channel_id: outId };
}

async function loadTracksByArtistName(artistName: string): Promise<any[]> {
  if (!supabase) return [];
  const name = normalizeString(artistName);
  if (!name) return [];

  const { data, error } = await supabase
    .from("tracks")
    .select("id, title, artist, external_id, youtube_id, artist_channel_id, cover_url, duration, created_at")
    // Stored artist names often differ by capitalization (e.g. "Michael Jackson" vs "Michael jackson").
    // Use case-insensitive equality.
    .ilike("artist", name)
    .order("created_at", { ascending: false })
    .limit(ARTIST_TRACK_LIMIT * 3);

  if (error) {
    console.warn(LOG_PREFIX, "tracks query failed", { artistName: name, code: error.code, message: error.message });
    return [];
  }

  return Array.isArray(data) ? data : [];
}

async function loadArtistRowByName(artistName: string): Promise<any | null> {
  if (!supabase) return null;
  const name = normalizeString(artistName);
  if (!name) return null;

  const key = deriveArtistKey(name);
  if (!key) return null;

  const { data, error } = await supabase
    .from("artists")
    .select("artist, artist_key, youtube_channel_id, thumbnail_url, banner_url")
    .eq("artist_key", key)
    .limit(1)
    .maybeSingle();

  if (error) {
    console.warn(LOG_PREFIX, "artists lookup by key failed", { artistName: name, code: error.code, message: error.message });
    return null;
  }

  return data ?? null;
}

async function loadTracksByChannelId(youtube_channel_id: string): Promise<any[]> {
  if (!supabase) return [];
  const id = normalizeString(youtube_channel_id);
  if (!id) return [];

  const { data, error } = await supabase
    .from("tracks")
    .select("id, title, artist, external_id, youtube_id, artist_channel_id, cover_url, duration, created_at")
    .eq("artist_channel_id", id)
    .order("created_at", { ascending: false })
    .limit(ARTIST_TRACK_LIMIT * 3);

  if (error) {
    console.warn(LOG_PREFIX, "tracks by channel query failed", { youtube_channel_id: id, code: error.code, message: error.message });
    return [];
  }

  return Array.isArray(data) ? data : [];
}

async function loadPlaylistsByChannelId(youtube_channel_id: string): Promise<any[]> {
  if (!supabase) return [];
  const id = normalizeString(youtube_channel_id);
  if (!id) return [];

  const { data, error } = await supabase
    .from("playlists")
    .select("id, title, description, external_id, channel_id, cover_url, created_at, sync_status, view_count")
    .eq("channel_id", id)
    .order("created_at", { ascending: false })
    .limit(ARTIST_PLAYLIST_LIMIT * 3);

  if (error) {
    console.warn(LOG_PREFIX, "playlists by channel query failed", { youtube_channel_id: id, code: error.code, message: error.message });
    return [];
  }

  const rows = Array.isArray(data) ? data : [];
  if (rows.length > 0) return rows;

  // Fallback: use playlists_raw (thumbnail_url) when playlists table has not been hydrated yet.
  const { data: rawData, error: rawError } = await supabase
    .from("playlists_raw")
    .select("id, external_id, title, description, channel_id, thumbnail_url, fetched_on")
    .eq("channel_id", id)
    .order("fetched_on", { ascending: false })
    .limit(ARTIST_PLAYLIST_LIMIT * 3);

  if (rawError) {
    console.warn(LOG_PREFIX, "playlists_raw by channel query failed", { youtube_channel_id: id, code: rawError.code, message: rawError.message });
    return [];
  }

  return (Array.isArray(rawData) ? rawData : []).map((r) => ({
    id: normalizeString((r as any)?.id) || normalizeString((r as any)?.external_id),
    external_id: normalizeString((r as any)?.external_id) || null,
    title: normalizeString((r as any)?.title) || "Untitled",
    description: normalizeNullableString((r as any)?.description),
    channel_id: normalizeString((r as any)?.channel_id) || id,
    cover_url: normalizeNullableString((r as any)?.thumbnail_url) ?? null,
    created_at: normalizeNullableString((r as any)?.fetched_on),
    sync_status: "raw",
    view_count: null,
  }));
}

async function loadArtistMediaByChannelId(youtube_channel_id: string, artistName: string): Promise<ApiArtistMedia> {
  const base: ApiArtistMedia = {
    artist_name: artistName,
    youtube_channel_id: youtube_channel_id || null,
    thumbnail_url: null,
    banner_url: null,
  };

  if (!supabase) return base;
  const id = normalizeString(youtube_channel_id);
  if (!id) return base;

  try {
    const { data, error } = await supabase
      .from("artists")
      .select("thumbnail_url, banner_url, youtube_channel_id")
      .eq("youtube_channel_id", id)
      .limit(1)
      .maybeSingle();

    if (error) {
      console.warn(LOG_PREFIX, "artists lookup failed", { youtube_channel_id: id, code: error.code, message: error.message });
      return base;
    }

    const thumb = normalizeNullableString((data as any)?.thumbnail_url);
    const banner = normalizeNullableString((data as any)?.banner_url);
    const outId = normalizeNullableString((data as any)?.youtube_channel_id) ?? id;

    if (thumb) {
      return {
        artist_name: artistName,
        youtube_channel_id: outId,
        thumbnail_url: thumb,
        banner_url: banner,
      };
    }

    // Fallback: fetch fresh channel metadata to hydrate thumbnails when missing.
    try {
      const validation = await validateYouTubeChannelId(id);
      if (validation.status === "valid") {
        const freshThumb = normalizeNullableString(validation.thumbnailUrl);
        const freshBanner = normalizeNullableString((validation.channel as any)?.brandingSettings?.image?.bannerExternalUrl);

        if (freshThumb || freshBanner) {
          await supabase
            .from("artists")
            .update({ thumbnail_url: freshThumb ?? null, banner_url: freshBanner ?? null })
            .eq("youtube_channel_id", id);

          return {
            artist_name: artistName,
            youtube_channel_id: outId,
            thumbnail_url: freshThumb ?? null,
            banner_url: freshBanner ?? null,
          };
        }
      }
    } catch {
      // best-effort, ignore
    }

    return {
      artist_name: artistName,
      youtube_channel_id: outId,
      thumbnail_url: thumb,
      banner_url: banner,
    };
  } catch (err: any) {
    console.warn(LOG_PREFIX, "artists lookup unexpected error", { youtube_channel_id: id, message: err?.message ? String(err.message) : "unknown" });
    return base;
  }
}

async function loadPlaylistsViaPlaylistTracks(trackIds: string[]): Promise<any[]> {
  if (!supabase) return [];
  const ids = trackIds.map((x) => normalizeString(x)).filter(Boolean);
  if (ids.length === 0) return [];

  const playlistIds = new Set<string>();

  for (const chunk of chunkArray(ids, IN_CHUNK)) {
    const { data, error } = await supabase
      .from("playlist_tracks")
      .select("playlist_id")
      .in("track_id", chunk);
    if (error) {
      console.warn(LOG_PREFIX, "playlist_tracks query failed", { code: error.code, message: error.message });
      return [];
    }

    for (const row of Array.isArray(data) ? data : []) {
      const pid = normalizeString((row as any)?.playlist_id);
      if (pid) playlistIds.add(pid);
    }
  }

  const playlistIdList = Array.from(playlistIds);
  if (playlistIdList.length === 0) return [];

  const playlists: any[] = [];
  for (const chunk of chunkArray(playlistIdList, IN_CHUNK)) {
    const { data, error } = await supabase
      .from("playlists")
      .select("id, title, description, external_id, channel_id, cover_url, created_at, sync_status, view_count")
      .in("id", chunk);
    if (error) {
      console.warn(LOG_PREFIX, "playlists query failed", { code: error.code, message: error.message });
      return [];
    }

    for (const row of Array.isArray(data) ? data : []) playlists.push(row);
  }

  playlists.sort((a, b) => {
    const ta = normalizeString((a as any)?.title).toLowerCase();
    const tb = normalizeString((b as any)?.title).toLowerCase();
    return ta.localeCompare(tb);
  });

  return playlists.slice(0, ARTIST_PLAYLIST_LIMIT * 3);
}

function mapTracksForFrontend(rows: any[], artistName: string): ApiTrack[] {
  const out: ApiTrack[] = [];
  for (const t of Array.isArray(rows) ? rows : []) {
    const id = normalizeString(t?.id);
    const title = normalizeString(t?.title) || "Untitled";
    const youtube_video_id = normalizeString(t?.external_id) || normalizeString(t?.youtube_id);
    if (!id || !youtube_video_id) continue;

    const duration = typeof t?.duration === "number" && Number.isFinite(t.duration) ? t.duration : null;

    out.push({
      id,
      title,
      youtube_video_id,
      cover_url: normalizeNullableString(t?.cover_url) ?? null,
      duration,
      youtube_channel_id: normalizeNullableString(t?.artist_channel_id) ?? undefined,
      artist_name: normalizeNullableString(t?.artist) ?? artistName,
      created_at: normalizeNullableString(t?.created_at),
    });
  }
  return out;
}

function mapPlaylistsForFrontend(rows: any[]): ApiPlaylist[] {
  const out: ApiPlaylist[] = [];
  for (const p of Array.isArray(rows) ? rows : []) {
    const id = normalizeString(p?.id);
    const title = normalizeString(p?.title) || "Untitled";
    const youtube_playlist_id = normalizeString(p?.external_id);
    if (!id) continue;
    // If external_id is missing we still return the playlist so artist page shows something; filter only OLAK when present.
    if (youtube_playlist_id && isOlakPlaylistId(youtube_playlist_id)) continue;

    out.push({
      id,
      title,
      description: normalizeNullableString(p?.description) ?? null,
      youtube_playlist_id,
      cover_url: normalizeNullableString(p?.cover_url) ?? null,
      youtube_channel_id: normalizeNullableString(p?.channel_id) ?? undefined,
      source: normalizeNullableString(p?.sync_status) ?? undefined,
      created_at: normalizeNullableString(p?.created_at),
      like_count: typeof p?.like_count === "number" ? p.like_count : null,
      view_count: typeof p?.view_count === "number" ? p.view_count : null,
      public_like_count: typeof p?.public_like_count === "number" ? p.public_like_count : null,
      public_view_count: typeof p?.public_view_count === "number" ? p.public_view_count : null,
    });
  }
  return out;
}

async function handleArtistLocalRequest(artistIdentifierRaw: string): Promise<OkResponse | NotReadyResponse> {
  const artistIdentifier = normalizeString(artistIdentifierRaw);

  try {
    if (!supabase) throw new Error("Supabase not configured");
    if (!artistIdentifier || artistIdentifier.length < MIN_QUERY_CHARS) throw new Error("Missing artist");

    // Prefer artists table if present (gives stable channelId + media even if no tracks yet).
    // NOTE: artistIdentifier can be either a display name ("AC/DC") or an artist_key ("ac-dc").
    const artistRow = await loadArtistRowByName(artistIdentifier);
    const artistDisplayName = normalizeString((artistRow as any)?.artist) || artistIdentifier;
    const channelId = normalizeString((artistRow as any)?.youtube_channel_id);

    // IMPORTANT: We intentionally merge BOTH sources when channelId is present.
    // Rationale: search-based ingestion and "regular" playlists may store tracks under the same artist name
    // but a different artist_channel_id. If we only show channelId-scoped tracks, content can appear missing.
    const [trackRowsByChannel, trackRowsByName] = await Promise.all([
      channelId ? loadTracksByChannelId(channelId) : Promise.resolve([]),
      loadTracksByArtistName(artistDisplayName),
    ]);

    const trackRowDedupe = new Map<string, any>();
    for (const r of Array.isArray(trackRowsByChannel) ? trackRowsByChannel : []) {
      const key = normalizeString((r as any)?.id) || normalizeString((r as any)?.external_id) || normalizeString((r as any)?.youtube_id);
      if (key) trackRowDedupe.set(key, r);
    }
    for (const r of Array.isArray(trackRowsByName) ? trackRowsByName : []) {
      const key = normalizeString((r as any)?.id) || normalizeString((r as any)?.external_id) || normalizeString((r as any)?.youtube_id);
      if (key && !trackRowDedupe.has(key)) trackRowDedupe.set(key, r);
    }

    const mergedTrackRows = Array.from(trackRowDedupe.values());
    const tracks = mapTracksForFrontend(mergedTrackRows, artistDisplayName).slice(0, ARTIST_TRACK_LIMIT);

    const artist = channelId
      ? await loadArtistMediaByChannelId(channelId, artistDisplayName)
      : await loadArtistMediaByChannelId(
          normalizeString((Array.isArray(mergedTrackRows) ? mergedTrackRows : [])[0]?.artist_channel_id) ||
            tracks.map((t) => normalizeString(t.youtube_channel_id)).find(Boolean) ||
            "",
          artistDisplayName
        );

    // Merge playlists from both sources:
    // - channelId playlists (official)
    // - any playlists that contain currently-known tracks ("regular" playlists)
    const [playlistRowsByChannel, playlistRowsByTracks] = await Promise.all([
      channelId ? loadPlaylistsByChannelId(channelId) : Promise.resolve([]),
      loadPlaylistsViaPlaylistTracks(tracks.map((t) => t.id)),
    ]);

    const playlistRowDedupe = new Map<string, any>();
    for (const r of Array.isArray(playlistRowsByChannel) ? playlistRowsByChannel : []) {
      const key = normalizeString((r as any)?.id) || normalizeString((r as any)?.external_id);
      if (key) playlistRowDedupe.set(key, r);
    }
    for (const r of Array.isArray(playlistRowsByTracks) ? playlistRowsByTracks : []) {
      const key = normalizeString((r as any)?.id) || normalizeString((r as any)?.external_id);
      if (key && !playlistRowDedupe.has(key)) playlistRowDedupe.set(key, r);
    }

    const playlistRows = Array.from(playlistRowDedupe.values());
    const playlists = mapPlaylistsForFrontend(playlistRows).slice(0, ARTIST_PLAYLIST_LIMIT);

    console.info(LOG_PREFIX, { artistName: artistDisplayName, playlistsCount: playlists.length, tracksCount: tracks.length });

    // If we have playlists but no tracks yet, kick off ingest in the background.
    // This ensures "tracks from playlists" appear shortly after playlists do.
    if (tracks.length === 0 && playlists.length > 0) {
      const ingestName = artistDisplayName || artistIdentifier;
      const ingestKey = normalizeArtistKey(ingestName);
      if (ingestKey) {
        const ingestMap = getIngestMap();
        const entry: IngestEntry =
          ingestMap.get(ingestKey) ?? { promise: null, startedAt: null, lastCompletedAt: null, lastFailedAt: null };

        if (entry.promise) {
          console.info(LOG_PREFIX, "INGEST_INFLIGHT", {
            ingestName,
            ingestKey,
            ageMs: entry.startedAt ? Date.now() - entry.startedAt : null,
          });
        } else {
          console.info(LOG_PREFIX, "INGEST_SCHEDULED", {
            ingestName,
            ingestKey,
            youtube_channel_id: channelId || null,
          });

          entry.startedAt = Date.now();
          entry.promise = (async () => {
            // Ensure the response returns first.
            await new Promise<void>((resolve) => setImmediate(resolve));
            try {
              let resolvedChannelId: string | null = channelId || null;

              // If we don't have a stable channelId, try exact cache lookup first.
              if (!resolvedChannelId) {
                const cached = await findYoutubeChannelByArtistNameExact(ingestName);
                if (cached?.youtube_channel_id) {
                  resolvedChannelId = cached.youtube_channel_id;
                  console.info(LOG_PREFIX, "CACHE_HIT", { ingestName, channelId: resolvedChannelId });

                  const validation = await validateYouTubeChannelId(resolvedChannelId);
                  console.info(LOG_PREFIX, "CHANNELS_LIST", { ingestName, channelId: resolvedChannelId, result: validation.status });

                  if (validation.status === "invalid") {
                    await deleteYoutubeChannelMappingByChannelId(resolvedChannelId);
                    console.info(LOG_PREFIX, "CACHE_DELETE_INVALID", { ingestName, channelId: resolvedChannelId });
                    resolvedChannelId = null;
                  } else if (validation.status === "error") {
                    console.warn(LOG_PREFIX, "CHANNELS_LIST_ERROR", { ingestName, channelId: resolvedChannelId, error: validation.error });
                    resolvedChannelId = null;
                  }
                }
              }

              // As a last resort (route-only), search for a channel id then ingest by channel id.
              if (!resolvedChannelId) {
                console.info(LOG_PREFIX, "SEARCH_LIST_CALL", { ingestName });
                const candidates = await youtubeSearchArtistChannel(ingestName);
                const first = Array.isArray(candidates) ? candidates[0] : null;
                const candidateId = first?.channelId ? String(first.channelId).trim() : "";
                const candidateTitle = first?.title ? String(first.title).trim() : "";

                if (candidateId) {
                  const validation = await validateYouTubeChannelId(candidateId);
                  console.info(LOG_PREFIX, "CHANNELS_LIST", {
                    ingestName,
                    channelId: candidateId,
                    result: validation.status,
                    source: "search",
                  });

                  if (validation.status === "valid") {
                    resolvedChannelId = candidateId;
                    await upsertYoutubeChannelMapping({ name: ingestName.toLowerCase(), youtube_channel_id: resolvedChannelId });
                    console.info(LOG_PREFIX, "CACHE_UPSERT", {
                      ingestName,
                      channelId: resolvedChannelId,
                      channelTitle: (validation.channelTitle ?? candidateTitle) || null,
                    });
                  }
                }
              }

              if (resolvedChannelId) {
                await ingestArtistFromYouTubeByChannelId({ youtube_channel_id: resolvedChannelId, artistName: ingestName });
              }
              entry.lastCompletedAt = Date.now();
            } catch (e) {
              entry.lastFailedAt = Date.now();
              void e;
            } finally {
              entry.promise = null;
              entry.startedAt = null;
              ingestMap.set(ingestKey, entry);
            }
          })();

          ingestMap.set(ingestKey, entry);
        }
      }
    }

    // If there is no local content yet, indicate that the artist is still being prepared.
    // IMPORTANT: we do NOT cache this response so it can become available immediately after ingest.
    // Also: kick off an ingest in the background so direct artist-page opens work.
    if (playlists.length === 0 && tracks.length === 0) {
      const ingestName = artistDisplayName || artistIdentifier;
      const ingestKey = normalizeArtistKey(ingestName);
      if (ingestKey) {
        const ingestMap = getIngestMap();
        const entry: IngestEntry =
          ingestMap.get(ingestKey) ?? { promise: null, startedAt: null, lastCompletedAt: null, lastFailedAt: null };

        if (entry.promise) {
          console.info(LOG_PREFIX, "INGEST_INFLIGHT", {
            ingestName,
            ingestKey,
            ageMs: entry.startedAt ? Date.now() - entry.startedAt : null,
          });
        } else {
          console.info(LOG_PREFIX, "INGEST_SCHEDULED", {
            ingestName,
            ingestKey,
            youtube_channel_id: channelId || null,
          });

          entry.startedAt = Date.now();
          entry.promise = (async () => {
            // Ensure the response returns first.
            await new Promise<void>((resolve) => setImmediate(resolve));
            try {
              let resolvedChannelId: string | null = channelId || null;

              // If we don't have a stable channelId, try exact cache lookup first.
              if (!resolvedChannelId) {
                const cached = await findYoutubeChannelByArtistNameExact(ingestName);
                if (cached?.youtube_channel_id) {
                  resolvedChannelId = cached.youtube_channel_id;
                  console.info(LOG_PREFIX, "CACHE_HIT", { ingestName, channelId: resolvedChannelId });

                  const validation = await validateYouTubeChannelId(resolvedChannelId);
                  console.info(LOG_PREFIX, "CHANNELS_LIST", { ingestName, channelId: resolvedChannelId, result: validation.status });

                  if (validation.status === "invalid") {
                    await deleteYoutubeChannelMappingByChannelId(resolvedChannelId);
                    console.info(LOG_PREFIX, "CACHE_DELETE_INVALID", { ingestName, channelId: resolvedChannelId });
                    resolvedChannelId = null;
                  } else if (validation.status === "error") {
                    console.warn(LOG_PREFIX, "CHANNELS_LIST_ERROR", { ingestName, channelId: resolvedChannelId, error: validation.error });
                    resolvedChannelId = null;
                  }
                }
              }

              // As a last resort (route-only), search for a channel id then ingest by channel id.
              if (!resolvedChannelId) {
                console.info(LOG_PREFIX, "SEARCH_LIST_CALL", { ingestName });
                const candidates = await youtubeSearchArtistChannel(ingestName);
                const first = Array.isArray(candidates) ? candidates[0] : null;
                const candidateId = first?.channelId ? String(first.channelId).trim() : "";
                const candidateTitle = first?.title ? String(first.title).trim() : "";

                if (candidateId) {
                  const validation = await validateYouTubeChannelId(candidateId);
                  console.info(LOG_PREFIX, "CHANNELS_LIST", {
                    ingestName,
                    channelId: candidateId,
                    result: validation.status,
                    source: "search",
                  });

                  if (validation.status === "valid") {
                    resolvedChannelId = candidateId;
                    await upsertYoutubeChannelMapping({ name: ingestName.toLowerCase(), youtube_channel_id: resolvedChannelId });
                    console.info(LOG_PREFIX, "CACHE_UPSERT", {
                      ingestName,
                      channelId: resolvedChannelId,
                      channelTitle: (validation.channelTitle ?? candidateTitle) || null,
                    });
                  }
                }
              }

              if (resolvedChannelId) {
                await ingestArtistFromYouTubeByChannelId({ youtube_channel_id: resolvedChannelId, artistName: ingestName });
              }
              entry.lastCompletedAt = Date.now();
            } catch (e) {
              entry.lastFailedAt = Date.now();
              void e;
            } finally {
              entry.promise = null;
              entry.startedAt = null;
              ingestMap.set(ingestKey, entry);
            }
          })();

          ingestMap.set(ingestKey, entry);
        }
      }

      return { status: "not_ready" };
    }

    return { status: "ok", artist, playlists, tracks };
  } catch (err: any) {
    console.warn(LOG_PREFIX, "ERROR", { artistName: artistIdentifier, message: err?.message ? String(err.message) : "unknown" });
    throw err;
  }
}

/**
 * GET /api/artist?artist_key=ac-dc
 * GET /api/artist?artist=AC%2FDC
 *
 * Safer than path params because '/' cannot split routing.
 */
router.get("/", async (req, res) => {
  const q = (req.query || {}) as QueryArtistRequest;
  const artistKeyParam = normalizeString(q.artist_key);
  const artistNameParam = normalizeString(q.artist);
  const identifier = artistKeyParam || artistNameParam;

  try {
    const key = cacheKeyForIdentifier(identifier);
    const cached = key ? await getCachedArtist(key) : null;
    const cacheFresh = cached ? await isCachedPayloadFresh(cached) : false;
    if (cached && cacheFresh) {
      const inm = typeof req.headers["if-none-match"] === "string" ? req.headers["if-none-match"] : "";
      res.setHeader("ETag", cached.etag);
      res.setHeader("Cache-Control", "public, max-age=60, stale-while-revalidate=300");
      if (inm && inm === cached.etag) return res.status(304).end();
      return res.status(200).json(cached.body);
    }

    const body = await handleArtistLocalRequest(identifier);
    const etag = makeEtagFromBody(body);
    const okBody = (body as any)?.status === "ok";
    const tracksLen = okBody && Array.isArray((body as any)?.tracks) ? (body as any).tracks.length : 0;
    const playlistsLen = okBody && Array.isArray((body as any)?.playlists) ? (body as any).playlists.length : 0;
    const hasContent = okBody && (tracksLen > 0 || playlistsLen > 0);
    // If we only have playlists, we want rapid revalidation because tracks may arrive moments later.
    const isPartial = okBody && playlistsLen > 0 && tracksLen === 0;
    if (key && okBody && hasContent && !isPartial) {
      const cachedPayload: CachedArtistPayload = { etag, body: body as OkResponse };
      artistResponseCache.set(key, cachedPayload);
      void persistArtistCache(key, cachedPayload);
      res.setHeader("Cache-Control", "public, max-age=60, stale-while-revalidate=300");
    } else {
      res.setHeader("Cache-Control", "no-store");
    }

    const inm = typeof req.headers["if-none-match"] === "string" ? req.headers["if-none-match"] : "";
    res.setHeader("ETag", etag);
    if (inm && inm === etag) return res.status(304).end();
    return res.status(200).json(body);
  } catch (err: any) {
    const message = err?.message ? String(err.message) : "Internal error";
    if (message === "Missing artist") return res.status(400).json({ error: "Missing artist" });
    if (message === "Supabase not configured") return res.status(500).json({ error: "Supabase not configured" });
    return res.status(500).json({ error: "Internal error" });
  }
});

/**
 * GET /api/artist/:artistName
 *
 * MUST be pure local DB. NEVER call YouTube.
 */
router.get("/:artistName", async (req, res) => {
  const artistName = normalizeString(req.params.artistName);

  try {
    const key = cacheKeyForIdentifier(artistName);
    const cached = key ? await getCachedArtist(key) : null;
    const cacheFresh = cached ? await isCachedPayloadFresh(cached) : false;
    if (cached && cacheFresh) {
      const inm = typeof req.headers["if-none-match"] === "string" ? req.headers["if-none-match"] : "";
      res.setHeader("ETag", cached.etag);
      res.setHeader("Cache-Control", "public, max-age=60, stale-while-revalidate=300");
      if (inm && inm === cached.etag) return res.status(304).end();
      return res.status(200).json(cached.body);
    }

    const body = await handleArtistLocalRequest(artistName);
    const etag = makeEtagFromBody(body);
    const okBody = (body as any)?.status === "ok";
    const tracksLen = okBody && Array.isArray((body as any)?.tracks) ? (body as any).tracks.length : 0;
    const playlistsLen = okBody && Array.isArray((body as any)?.playlists) ? (body as any).playlists.length : 0;
    const hasContent = okBody && (tracksLen > 0 || playlistsLen > 0);
    const isPartial = okBody && playlistsLen > 0 && tracksLen === 0;
    if (key && okBody && hasContent && !isPartial) {
      const cachedPayload: CachedArtistPayload = { etag, body: body as OkResponse };
      artistResponseCache.set(key, cachedPayload);
      void persistArtistCache(key, cachedPayload);
      res.setHeader("Cache-Control", "public, max-age=60, stale-while-revalidate=300");
    } else {
      res.setHeader("Cache-Control", "no-store");
    }

    const inm = typeof req.headers["if-none-match"] === "string" ? req.headers["if-none-match"] : "";
    res.setHeader("ETag", etag);
    if (inm && inm === etag) return res.status(304).end();
    return res.status(200).json(body);
  } catch (err: any) {
    const message = err?.message ? String(err.message) : "Internal error";
    if (message === "Missing artist") return res.status(400).json({ error: "Missing artist" });
    if (message === "Supabase not configured") return res.status(500).json({ error: "Supabase not configured" });
    return res.status(500).json({ error: "Internal error" });
  }
});

export default router;
