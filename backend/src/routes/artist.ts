import { Router } from "express";

import supabase from "../services/supabaseClient";

const router = Router();

const LOG_PREFIX = "[ArtistLocal]";
const MIN_QUERY_CHARS = 2;
const IN_CHUNK = 200;

type ApiArtist = {
  id: string;
  name: string;
  youtube_channel_id: string;
  spotify_artist_id?: string | null;
  avatar_url?: string | null;
};

type ApiPlaylist = {
  id: string;
  title: string;
  youtube_playlist_id: string;
  youtube_channel_id: string;
  source: string;
  created_at: string | null;
};

type ApiTrack = {
  id: string;
  title: string;
  youtube_video_id: string;
  youtube_channel_id: string;
  artist_name: string | null;
  created_at: string | null;
};

type OkResponse = {
  status: "ok";
  artist: ApiArtist;
  playlists: ApiPlaylist[];
  tracks: ApiTrack[];
};

type NotReadyResponse = {
  status: "not_ready";
  artistName: string;
  message: string;
  playlists: ApiPlaylist[];
  tracks: ApiTrack[];
};

type DeprecatedResponse = {
  status: "deprecated";
  message: string;
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

function safeArtistId(artistName: string): string {
  const raw = normalizeString(artistName);
  const cleaned = raw
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  const slug = cleaned ? cleaned.replace(/\s/g, "-") : "artist";
  return `artist:${slug || "artist"}`;
}

async function loadArtistRowByName(artistName: string): Promise<any | null> {
  if (!supabase) return null;
  const name = normalizeString(artistName);
  if (!name) return null;

  // Keep this defensive: some deployments may not have all columns.
  const { data, error } = await supabase
    .from("artists")
    .select("id, artist, youtube_channel_id, thumbnail_url, avatar_url, spotify_artist_id")
    .eq("artist", name)
    .limit(1)
    .maybeSingle();

  if (error) return null;
  return data ?? null;
}

async function loadTracksByArtistName(artistName: string): Promise<any[]> {
  if (!supabase) return [];
  const name = normalizeString(artistName);
  if (!name) return [];

  const { data, error } = await supabase
    .from("tracks")
    .select("id, title, external_id, youtube_id, artist, artist_channel_id, created_at")
    .eq("artist", name)
    .order("created_at", { ascending: false })
    .limit(500);

  if (error) return [];
  return Array.isArray(data) ? data : [];
}

async function loadPlaylistsByChannelId(youtube_channel_id: string): Promise<any[]> {
  if (!supabase) return [];
  const cid = normalizeString(youtube_channel_id);
  if (!cid) return [];

  const { data, error } = await supabase
    .from("playlists")
    .select("id, title, external_id, channel_id, channel_title, created_at, sync_status, source")
    .eq("channel_id", cid)
    .order("title", { ascending: true })
    .limit(200);

  if (error) return [];
  return Array.isArray(data) ? data : [];
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
    if (error) return [];
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
      .select("id, title, external_id, channel_id, channel_title, created_at, sync_status, source")
      .in("id", chunk);
    if (error) return [];
    for (const row of Array.isArray(data) ? data : []) playlists.push(row);
  }

  // Determinističan redosled.
  playlists.sort((a, b) => {
    const ta = normalizeString((a as any)?.title).toLowerCase();
    const tb = normalizeString((b as any)?.title).toLowerCase();
    return ta.localeCompare(tb);
  });

  return playlists;
}

function mapArtistForFrontend(artistName: string, artistRow: any | null, fallbackChannelId: string | null): ApiArtist {
  const id = normalizeString(artistRow?.id) || safeArtistId(artistName);
  const youtube_channel_id = normalizeString(artistRow?.youtube_channel_id) || normalizeString(fallbackChannelId) || "";
  const avatar_url =
    normalizeNullableString(artistRow?.thumbnail_url) ||
    normalizeNullableString(artistRow?.avatar_url) ||
    null;

  return {
    id,
    name: normalizeString(artistRow?.artist) || artistName,
    youtube_channel_id,
    spotify_artist_id: artistRow?.spotify_artist_id ?? null,
    avatar_url,
  };
}

function mapPlaylistsForFrontend(rows: any[], fallbackChannelId: string | null): ApiPlaylist[] {
  const out: ApiPlaylist[] = [];
  for (const p of Array.isArray(rows) ? rows : []) {
    const id = normalizeString(p?.id);
    const title = normalizeString(p?.title) || "Untitled";
    const youtube_playlist_id = normalizeString(p?.external_id);
    if (!id || !youtube_playlist_id) continue;

    const youtube_channel_id = normalizeString(p?.channel_id) || normalizeString(fallbackChannelId) || "";
    const source = normalizeString(p?.source) || normalizeString(p?.sync_status) || "youtube";
    const created_at = normalizeNullableString(p?.created_at);

    out.push({ id, title, youtube_playlist_id, youtube_channel_id, source, created_at });
  }
  return out;
}

function mapTracksForFrontend(rows: any[], artistName: string, fallbackChannelId: string | null): ApiTrack[] {
  const out: ApiTrack[] = [];
  for (const t of Array.isArray(rows) ? rows : []) {
    const id = normalizeString(t?.id);
    const title = normalizeString(t?.title) || "Untitled";
    const youtube_video_id = normalizeString(t?.external_id) || normalizeString(t?.youtube_id);
    if (!id || !youtube_video_id) continue;

    const youtube_channel_id = normalizeString(t?.artist_channel_id) || normalizeString(fallbackChannelId) || "";
    const created_at = normalizeNullableString(t?.created_at);

    // Lokalni contract: artist_name je stabilan artistName koji je tražen u URL-u.
    out.push({ id, title, youtube_video_id, youtube_channel_id, artist_name: artistName, created_at });
  }
  return out;
}

/**
 * GET /api/artist/:artistName
 *
 * APSOLUTNO PRAVILO: NULA YouTube API poziva.
 * Samo lokalni Supabase (artists/playlists/tracks/playlist_tracks).
 */
router.get("/:artistName", async (req, res) => {
  const artistName = normalizeString(req.params.artistName);

  try {
    if (!supabase) return res.status(500).json({ error: "Supabase not configured" });
    if (!artistName || artistName.length < MIN_QUERY_CHARS) {
      return res.status(400).json({ error: "Missing artistName" });
    }

    const [artistRow, tracksRows] = await Promise.all([
      loadArtistRowByName(artistName),
      loadTracksByArtistName(artistName),
    ]);

    const fallbackChannelId = normalizeNullableString(artistRow?.youtube_channel_id);

    // Playlists: primarno preko playlist_tracks + tracks.artist == artistName.
    // Fallback: ako postoji artists.youtube_channel_id, uzmi playlists po channel_id.
    const trackIds = tracksRows.map((t: any) => normalizeString(t?.id)).filter(Boolean);
    const [playlistsViaJoin, playlistsViaChannel] = await Promise.all([
      loadPlaylistsViaPlaylistTracks(trackIds),
      fallbackChannelId ? loadPlaylistsByChannelId(fallbackChannelId) : Promise.resolve([]),
    ]);

    const playlistById = new Map<string, any>();
    for (const p of [...(Array.isArray(playlistsViaJoin) ? playlistsViaJoin : []), ...(Array.isArray(playlistsViaChannel) ? playlistsViaChannel : [])]) {
      const id = normalizeString((p as any)?.id);
      if (!id) continue;
      if (!playlistById.has(id)) playlistById.set(id, p);
    }
    const playlistsRows = Array.from(playlistById.values());

    const playlists = mapPlaylistsForFrontend(playlistsRows, fallbackChannelId);
    const tracks = mapTracksForFrontend(tracksRows, artistName, fallbackChannelId);

    const hasLocal = playlists.length > 0 || tracks.length > 0;
    console.info(LOG_PREFIX, "GET", { artistName, playlists: playlists.length, tracks: tracks.length, hasLocal });

    if (!hasLocal) {
      const resp: NotReadyResponse = {
        status: "not_ready",
        artistName,
        message: "Sadržaj za ovog izvođača još nije spreman (ingestija nije završena).",
        playlists: [],
        tracks: [],
      };
      return res.status(200).json(resp);
    }

    const artist = mapArtistForFrontend(artistName, artistRow, fallbackChannelId);
    const resp: OkResponse = { status: "ok", artist, playlists, tracks };
    return res.status(200).json(resp);
  } catch (err: any) {
    console.error(LOG_PREFIX, "GET unexpected error", { artistName, message: err?.message ? String(err.message) : "unknown" });
    return res.status(500).json({ error: "Internal error" });
  }
});

/**
 * POST /api/artist/selected
 *
 * Ovaj endpoint se zadržava radi kompatibilnosti, ali:
 * - NULA YouTube API poziva
 * - NEMA hidracije
 * - Samo upsert u `youtube_channels` (lokalni DB cache)
 */
router.post("/selected", async (req, res) => {
  const artistName = normalizeString((req.body as any)?.artistName);
  const youtube_channel_id = normalizeString((req.body as any)?.youtube_channel_id);
  const thumbnail_url = normalizeNullableString((req.body as any)?.thumbnail_url);

  try {
    if (!supabase) return res.status(500).json({ error: "Supabase not configured" });

    // Ako više nije u upotrebi, ovo ostaje benigno.
    if (!artistName || !youtube_channel_id) {
      const resp: DeprecatedResponse = {
        status: "deprecated",
        message: "Ovaj endpoint je zastareo; izbor kanala više ne pokreće hidraciju.",
      };
      return res.status(200).json(resp);
    }

    const row = { name: artistName, youtube_channel_id, thumbnail_url };
    const { error } = await supabase
      .from("youtube_channels")
      .upsert(row, { onConflict: "youtube_channel_id" })
      .select("name, youtube_channel_id, thumbnail_url")
      .maybeSingle();

    if (error) {
      console.error(LOG_PREFIX, "POST /selected upsert failed", { artistName, youtube_channel_id, code: error.code, message: error.message });
      return res.status(500).json({ error: "Failed to persist channel mapping" });
    }

    console.info(LOG_PREFIX, "POST /selected", { artistName, youtube_channel_id });
    return res.status(200).json({ status: "ok", artistName, youtube_channel_id });
  } catch (err: any) {
    console.error(LOG_PREFIX, "POST /selected unexpected error", { artistName, youtube_channel_id, message: err?.message ? String(err.message) : "unknown" });
    return res.status(500).json({ error: "Internal error" });
  }
});

export default router;
