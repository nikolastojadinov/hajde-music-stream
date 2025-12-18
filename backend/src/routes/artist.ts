import { Router } from "express";
import crypto from "node:crypto";

import supabase from "../services/supabaseClient";
import { deriveArtistKey } from "../services/artistResolver";
import { TtlCache } from "../lib/ttlCache";

const router = Router();

const LOG_PREFIX = "[ArtistLocal]";
const MIN_QUERY_CHARS = 2;
const IN_CHUNK = 200;

const ARTIST_CACHE_TTL_MS = 60_000;
const artistResponseCache = new TtlCache<{ etag: string; body: unknown }>(ARTIST_CACHE_TTL_MS);

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
  youtube_playlist_id: string;
  cover_url?: string | null;
  youtube_channel_id?: string;
  source?: string;
  created_at?: string | null;
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
    .limit(500);

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
    .limit(500);

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
    .select("id, title, external_id, channel_id, cover_url, created_at, sync_status")
    .eq("channel_id", id)
    .order("created_at", { ascending: false })
    .limit(100);

  if (error) {
    console.warn(LOG_PREFIX, "playlists by channel query failed", { youtube_channel_id: id, code: error.code, message: error.message });
    return [];
  }

  return Array.isArray(data) ? data : [];
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
      .select("id, title, external_id, channel_id, cover_url, created_at, sync_status")
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

  return playlists;
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
    if (!id || !youtube_playlist_id) continue;

    out.push({
      id,
      title,
      youtube_playlist_id,
      cover_url: normalizeNullableString(p?.cover_url) ?? null,
      youtube_channel_id: normalizeNullableString(p?.channel_id) ?? undefined,
      source: normalizeNullableString(p?.sync_status) ?? undefined,
      created_at: normalizeNullableString(p?.created_at),
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

    let trackRows = channelId ? await loadTracksByChannelId(channelId) : await loadTracksByArtistName(artistDisplayName);
    // Many "official" album playlists live on "- Topic" or VEVO channels.
    // If we have a primary channelId but no tracks, fall back to artist-name matching.
    if (channelId && Array.isArray(trackRows) && trackRows.length === 0) {
      const byName = await loadTracksByArtistName(artistDisplayName);
      trackRows = byName;
    }
    const tracks = mapTracksForFrontend(trackRows, artistDisplayName);

    const artist = channelId
      ? await loadArtistMediaByChannelId(channelId, artistDisplayName)
      : await loadArtistMediaByChannelId(
          normalizeString((Array.isArray(trackRows) ? trackRows : [])[0]?.artist_channel_id) ||
            tracks.map((t) => normalizeString(t.youtube_channel_id)).find(Boolean) ||
            "",
          artistDisplayName
        );

    // Prefer channel-based playlists if we know the channelId; fallback to playlist_tracks join.
    let playlistRows = channelId ? await loadPlaylistsByChannelId(channelId) : await loadPlaylistsViaPlaylistTracks(tracks.map((t) => t.id));
    if (channelId && Array.isArray(playlistRows) && playlistRows.length === 0) {
      playlistRows = await loadPlaylistsViaPlaylistTracks(tracks.map((t) => t.id));
    }
    const playlists = mapPlaylistsForFrontend(playlistRows);

    console.info(LOG_PREFIX, { artistName: artistDisplayName, playlistsCount: playlists.length, tracksCount: tracks.length });

    // If there is no local content yet, indicate that the artist is still being prepared.
    // IMPORTANT: we do NOT cache this response so it can become available immediately after ingest.
    if (playlists.length === 0 && tracks.length === 0) {
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
    const cached = key ? artistResponseCache.get(key) : null;
    if (cached) {
      const inm = typeof req.headers["if-none-match"] === "string" ? req.headers["if-none-match"] : "";
      res.setHeader("ETag", cached.etag);
      res.setHeader("Cache-Control", "public, max-age=60, stale-while-revalidate=300");
      if (inm && inm === cached.etag) return res.status(304).end();
      return res.status(200).json(cached.body);
    }

    const body = await handleArtistLocalRequest(identifier);
    const etag = makeEtagFromBody(body);
    const okBody = (body as any)?.status === "ok";
    const hasContent = okBody && (Array.isArray((body as any)?.tracks) ? (body as any).tracks.length > 0 : false || Array.isArray((body as any)?.playlists) ? (body as any).playlists.length > 0 : false);
    if (key && okBody && hasContent) {
      artistResponseCache.set(key, { etag, body });
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
    const cached = key ? artistResponseCache.get(key) : null;
    if (cached) {
      const inm = typeof req.headers["if-none-match"] === "string" ? req.headers["if-none-match"] : "";
      res.setHeader("ETag", cached.etag);
      res.setHeader("Cache-Control", "public, max-age=60, stale-while-revalidate=300");
      if (inm && inm === cached.etag) return res.status(304).end();
      return res.status(200).json(cached.body);
    }

    const body = await handleArtistLocalRequest(artistName);
    const etag = makeEtagFromBody(body);
    const okBody = (body as any)?.status === "ok";
    const hasContent = okBody && (Array.isArray((body as any)?.tracks) ? (body as any).tracks.length > 0 : false || Array.isArray((body as any)?.playlists) ? (body as any).playlists.length > 0 : false);
    if (key && okBody && hasContent) {
      artistResponseCache.set(key, { etag, body });
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
