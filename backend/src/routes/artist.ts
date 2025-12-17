import { Router } from "express";

import supabase from "../services/supabaseClient";

const router = Router();

const LOG_PREFIX = "[ArtistLocal]";
const MIN_QUERY_CHARS = 2;
const IN_CHUNK = 200;

type ApiPlaylist = {
  id: string;
  title: string;
  youtube_playlist_id: string;
  youtube_channel_id?: string;
  source?: string;
  created_at?: string | null;
};

type ApiTrack = {
  id: string;
  title: string;
  youtube_video_id: string;
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
    .select("id, title, external_id, youtube_id, artist_channel_id, created_at")
    .eq("artist", name)
    .order("created_at", { ascending: false })
    .limit(500);

  if (error) {
    console.warn(LOG_PREFIX, "tracks query failed", { artistName: name, code: error.code, message: error.message });
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
      .select("id, title, external_id, channel_id, created_at, sync_status")
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

    out.push({
      id,
      title,
      youtube_video_id,
      youtube_channel_id: normalizeNullableString(t?.artist_channel_id) ?? undefined,
      artist_name: artistName,
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
      youtube_channel_id: normalizeNullableString(p?.channel_id) ?? undefined,
      source: normalizeNullableString(p?.sync_status) ?? undefined,
      created_at: normalizeNullableString(p?.created_at),
    });
  }
  return out;
}

/**
 * GET /api/artist/:artistName
 *
 * MUST be pure local DB. NEVER call YouTube.
 */
router.get("/:artistName", async (req, res) => {
  const artistName = normalizeString(req.params.artistName);

  try {
    if (!supabase) return res.status(500).json({ error: "Supabase not configured" });
    if (!artistName || artistName.length < MIN_QUERY_CHARS) {
      return res.status(400).json({ error: "Missing artistName" });
    }

    const trackRows = await loadTracksByArtistName(artistName);
    const tracks = mapTracksForFrontend(trackRows, artistName);

    // Artist media is derived from tracks.artist_channel_id (artist identity stays tracks.artist).
    const channelId =
      normalizeString((Array.isArray(trackRows) ? trackRows : [])[0]?.artist_channel_id) ||
      tracks.map((t) => normalizeString(t.youtube_channel_id)).find(Boolean) ||
      "";
    const artist = await loadArtistMediaByChannelId(channelId, artistName);

    const trackIds = tracks.map((t) => t.id);
    const playlistRows = await loadPlaylistsViaPlaylistTracks(trackIds);
    const playlists = mapPlaylistsForFrontend(playlistRows);

    console.info(LOG_PREFIX, { artistName, playlistsCount: playlists.length, tracksCount: tracks.length });

    if (playlists.length === 0 && tracks.length === 0) {
      const resp: NotReadyResponse = { status: "not_ready" };
      return res.status(200).json(resp);
    }

    const resp: OkResponse = { status: "ok", artist, playlists, tracks };
    return res.status(200).json(resp);
  } catch (err: any) {
    console.warn(LOG_PREFIX, "ERROR", { artistName, message: err?.message ? String(err.message) : "unknown" });
    return res.status(500).json({ error: "Internal error" });
  }
});

export default router;
