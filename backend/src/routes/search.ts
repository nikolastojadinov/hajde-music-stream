import { Router } from "express";

import supabase, {
  searchArtistChannelsForQuery,
  searchPlaylistsDualForQuery,
  searchTracksForQuery,
  type SearchArtistChannelRow,
  type SearchPlaylistRow,
  type SearchTrackRow,
} from "../services/supabaseClient";
import { spotifySearch } from "../services/spotifyClient";
import { youtubeSearchArtistChannel, youtubeSearchVideos } from "../services/youtubeClient";
import {
  deleteYoutubeChannelMappingByChannelId,
  deriveArtistKey,
  upsertYoutubeChannelMapping,
  validateYouTubeChannelId,
} from "../services/artistResolver";
import { ingestArtistFromYouTubeByChannelId } from "../services/ingestArtistFromYouTube";

const router = Router();

const MIN_QUERY_CHARS = 2;
const INGEST_DEBOUNCE_MS = 60_000;
const LOG_PREFIX = "[ArtistIngest]";

type ResolveMode = "track" | "artist" | "album" | "generic";

type ResolveRequestBody = {
  q?: unknown;
  mode?: unknown;
  spotify?: unknown;
};

type LocalTrack = {
  id: string;
  title: string;
  artist: string;
  externalId: string | null;
  coverUrl: string | null;
  duration: number | null;
};

type LocalPlaylist = {
  id: string;
  title: string;
  externalId: string | null;
  coverUrl: string | null;
};

type ResolvedArtistChannel = {
  channelId: string;
  title: string;
  thumbnailUrl: string | null;
};

type ArtistChannelsEnvelope = {
  local: ResolvedArtistChannel[];
  youtube: ResolvedArtistChannel[];
  decision: "local_only" | "youtube_fallback";
};

type YoutubeChannelsRow = {
  name: string;
  youtube_channel_id: string;
  thumbnail_url: string | null;
};

const lastTriggeredByArtistKey = new Map<string, number>();
const inflightByArtistKey = new Map<string, Promise<void>>();

function normalizeQuery(input: unknown): string {
  return typeof input === "string" ? input.trim() : "";
}

function normalizeMode(input: unknown): ResolveMode {
  const value = typeof input === "string" ? input : "";
  if (value === "track" || value === "artist" || value === "album" || value === "generic") return value;
  return "generic";
}

function safeArtistKey(artistName: string): string {
  const raw = normalizeQuery(artistName);
  const key = deriveArtistKey(raw);
  return key || raw.toLowerCase();
}

function mapTrackRow(row: SearchTrackRow): LocalTrack {
  return {
    id: String(row.id),
    title: typeof row.title === "string" ? row.title : "",
    artist: typeof row.artist === "string" ? row.artist : "",
    externalId: typeof row.external_id === "string" ? row.external_id : null,
    coverUrl: typeof row.cover_url === "string" ? row.cover_url : null,
    duration: typeof row.duration === "number" ? row.duration : null,
  };
}

function mapPlaylistRow(row: SearchPlaylistRow): LocalPlaylist {
  return {
    id: String(row.id),
    title: typeof row.title === "string" ? row.title : "",
    externalId: typeof row.external_id === "string" ? row.external_id : null,
    coverUrl: typeof row.cover_url === "string" ? row.cover_url : null,
  };
}

function mapLocalArtistChannelRow(row: SearchArtistChannelRow): ResolvedArtistChannel | null {
  const title = typeof row.name === "string" ? row.name.trim() : "";
  const channelId = typeof row.youtube_channel_id === "string" ? row.youtube_channel_id.trim() : "";
  const thumbnailUrl = typeof row.thumbnail_url === "string" ? row.thumbnail_url : null;

  if (!title || !channelId) return null;
  return { channelId, title, thumbnailUrl };
}

function mergeLegacyPlaylists(byTitle: LocalPlaylist[], byArtist: LocalPlaylist[]): LocalPlaylist[] {
  const seen = new Set<string>();
  const merged: LocalPlaylist[] = [];

  for (const p of byTitle) {
    if (!seen.has(p.id)) {
      seen.add(p.id);
      merged.push(p);
    }
  }

  for (const p of byArtist) {
    if (!seen.has(p.id)) {
      seen.add(p.id);
      merged.push(p);
    }
  }

  return merged;
}

function deriveYouTubeArtistChannelsFromVideos(
  videos: Array<{ channelId: string; channelTitle: string; thumbUrl?: string | null }>
): ResolvedArtistChannel[] {
  const seen = new Set<string>();
  const out: ResolvedArtistChannel[] = [];

  for (const v of videos) {
    const channelId = typeof v.channelId === "string" ? v.channelId : "";
    const title = typeof v.channelTitle === "string" ? v.channelTitle : "";
    if (!channelId || !title) continue;
    if (seen.has(channelId)) continue;

    seen.add(channelId);
    out.push({ channelId, title, thumbnailUrl: v.thumbUrl ?? null });
    if (out.length >= 2) break;
  }

  return out;
}

async function findYoutubeChannelMappingExactByName(artistName: string): Promise<YoutubeChannelsRow | null> {
  if (!supabase) return null;
  const name = normalizeQuery(artistName);
  if (name.length < MIN_QUERY_CHARS) return null;

  const { data, error } = await supabase
    .from("youtube_channels")
    .select("name, youtube_channel_id, thumbnail_url")
    // ilike without wildcards behaves like case-insensitive equality.
    .ilike("name", name)
    .limit(1)
    .maybeSingle();

  if (error || !data) return null;
  const outName = typeof (data as any)?.name === "string" ? String((data as any).name).trim() : "";
  const outId = typeof (data as any)?.youtube_channel_id === "string" ? String((data as any).youtube_channel_id).trim() : "";
  const outThumb = typeof (data as any)?.thumbnail_url === "string" ? String((data as any).thumbnail_url) : null;
  if (!outId) return null;

  return { name: outName || name, youtube_channel_id: outId, thumbnail_url: outThumb };
}

async function bestEffortSetTracksArtistName(opts: { youtube_channel_id: string; artistName: string }): Promise<void> {
  if (!supabase) return;
  const youtube_channel_id = normalizeQuery(opts.youtube_channel_id);
  const artistName = normalizeQuery(opts.artistName);
  if (!youtube_channel_id || !artistName) return;

  try {
    // This app filters playlists-by-artist via `tracks.artist`, so we force a stable artist string.
    // Safe/idempotent: repeated updates set the same value.
    const { error } = await supabase.from("tracks").update({ artist: artistName }).eq("artist_channel_id", youtube_channel_id);
    if (error) {
      console.warn(LOG_PREFIX, "tracks.artist update failed", { artistName, youtube_channel_id, code: error.code, message: error.message });
    }
  } catch (err) {
    console.warn(LOG_PREFIX, "tracks.artist update threw", { artistName, youtube_channel_id });
    void err;
  }
}

async function runArtistIngestFlow(artistNameRaw: string): Promise<void> {
  const artistName = normalizeQuery(artistNameRaw);
  if (artistName.length < MIN_QUERY_CHARS) return;
  if (!supabase) {
    console.info(LOG_PREFIX, "skip (supabase missing)", { artistName });
    return;
  }

  console.info(LOG_PREFIX, "start", { artistName });

  let channelId: string | null = null;
  let cacheHit = false;
  let calledSearchList = false;
  let candidatesCount = 0;

  try {
    const cached = await findYoutubeChannelMappingExactByName(artistName);
    if (cached?.youtube_channel_id) {
      cacheHit = true;
      channelId = cached.youtube_channel_id;
      console.info(LOG_PREFIX, "cache hit", { artistName, channelId });

      const validation = await validateYouTubeChannelId(channelId);
      console.info(LOG_PREFIX, "channels.list", { artistName, channelId, result: validation.status });

      if (validation.status === "invalid") {
        await deleteYoutubeChannelMappingByChannelId(channelId);
        console.info(LOG_PREFIX, "cache mapping deleted (invalid)", { artistName, channelId });
        channelId = null;
      } else if (validation.status === "error") {
        console.warn(LOG_PREFIX, "channels.list error", { artistName, channelId, error: validation.error });
        return;
      } else {
        // Best-effort: refresh mapping thumbnail/title; store under the *exact* search artistName.
        await upsertYoutubeChannelMapping({
          name: artistName,
          youtube_channel_id: channelId,
          thumbnail_url: validation.thumbnailUrl ?? cached.thumbnail_url ?? null,
        });
      }
    } else {
      console.info(LOG_PREFIX, "cache miss", { artistName });
    }

    if (!channelId) {
      calledSearchList = true;
      const candidates = await youtubeSearchArtistChannel(artistName);
      candidatesCount = Array.isArray(candidates) ? candidates.length : 0;
      console.info(LOG_PREFIX, "search.list", { artistName, candidatesCount });

      const first = Array.isArray(candidates) ? candidates[0] : null;
      const candidateId = first?.channelId ? String(first.channelId).trim() : "";
      if (!candidateId) return;

      const validation = await validateYouTubeChannelId(candidateId);
      console.info(LOG_PREFIX, "channels.list (candidate)", { artistName, channelId: candidateId, result: validation.status });

      if (validation.status === "invalid") {
        return;
      }
      if (validation.status === "error") {
        console.warn(LOG_PREFIX, "channels.list error (candidate)", { artistName, channelId: candidateId, error: validation.error });
        return;
      }

      channelId = candidateId;
      await upsertYoutubeChannelMapping({
        name: artistName,
        youtube_channel_id: channelId,
        thumbnail_url: validation.thumbnailUrl ?? null,
      });
      console.info(LOG_PREFIX, "cache mapping upserted", { artistName, channelId });
    }

    if (!channelId) return;

    console.info(LOG_PREFIX, "hydrate start", { artistName, channelId, cacheHit, calledSearchList, candidatesCount });
    const ingest = await ingestArtistFromYouTubeByChannelId({ youtube_channel_id: channelId, artistName });
    if (!ingest) {
      console.warn(LOG_PREFIX, "hydrate failed", { artistName, channelId });
      return;
    }

    await bestEffortSetTracksArtistName({ youtube_channel_id: channelId, artistName });

    console.info(LOG_PREFIX, "hydrate complete", {
      artistName,
      channelId,
      playlists_ingested: ingest.playlists_ingested,
      tracks_ingested: ingest.tracks_ingested,
    });
  } catch (err: any) {
    // Never break search; log-only.
    console.warn(LOG_PREFIX, "unexpected error", {
      artistName,
      cacheHit,
      calledSearchList,
      candidatesCount,
      message: err?.message ? String(err.message) : "unknown",
    });
  }
}

function triggerIngestForArtistName(artistNameRaw: string): boolean {
  const artistName = normalizeQuery(artistNameRaw);
  if (artistName.length < MIN_QUERY_CHARS) return false;

  const key = safeArtistKey(artistName);
  if (!key) return false;

  const now = Date.now();
  const last = lastTriggeredByArtistKey.get(key);
  if (typeof last === "number" && now - last < INGEST_DEBOUNCE_MS) {
    console.info(LOG_PREFIX, "debounced", { artistName, key });
    return false;
  }

  if (inflightByArtistKey.has(key)) {
    console.info(LOG_PREFIX, "skip (inflight)", { artistName, key });
    return false;
  }

  lastTriggeredByArtistKey.set(key, now);

  const p = runArtistIngestFlow(artistName)
    .catch((err) => {
      console.warn(LOG_PREFIX, "ingest promise rejected", { artistName, key, message: err?.message ? String(err.message) : "unknown" });
    })
    .finally(() => {
      inflightByArtistKey.delete(key);
    });

  inflightByArtistKey.set(key, p);
  void p;
  return true;
}

router.get("/suggest", async (req, res) => {
  const q = normalizeQuery(req.query.q);
  try {
    const result = await spotifySearch(q);
    return res.json({ q, source: "spotify", ...result });
  } catch {
    return res.status(500).json({ error: "Search suggest failed" });
  }
});

router.post("/resolve", async (req, res) => {
  const body = (req.body || {}) as ResolveRequestBody;
  const q = normalizeQuery(body.q);
  const mode = normalizeMode(body.mode);

  if (!supabase) {
    return res.status(503).json({ error: "Search resolve unavailable" });
  }

  if (q.length < MIN_QUERY_CHARS) {
    const artist_channels: ArtistChannelsEnvelope = { local: [], youtube: [], decision: "local_only" };
    return res.json({
      q,
      tracks: [],
      playlists_by_title: [],
      playlists_by_artist: [],
      artist_channels,
      local: { tracks: [], playlists: [] },
      decision: "local_only",
      ingestionTriggered: false,
    });
  }

  // Fire-and-forget: do NOT block search response.
  // We intentionally trigger on the exact query string as artistName.
  // Mode is currently unused for gating to avoid changing client behavior.
  void mode;
  const ingestionTriggered = triggerIngestForArtistName(q);

  try {
    const [trackRows, playlistsDual, artistChannelRows] = await Promise.all([
      searchTracksForQuery(q),
      searchPlaylistsDualForQuery(q),
      searchArtistChannelsForQuery(q),
    ]);

    const tracks = trackRows.map(mapTrackRow);
    const playlists_by_title = playlistsDual.playlists_by_title.map(mapPlaylistRow);
    const playlists_by_artist = playlistsDual.playlists_by_artist.map(mapPlaylistRow);

    const artistChannelsLocal = artistChannelRows
      .map(mapLocalArtistChannelRow)
      .filter((x): x is ResolvedArtistChannel => Boolean(x));

    const local = {
      tracks,
      playlists: mergeLegacyPlaylists(playlists_by_title, playlists_by_artist),
    };

    const artist_channels: ArtistChannelsEnvelope = {
      local: artistChannelsLocal,
      youtube: [],
      decision: "local_only",
    };

    const hasLocal = tracks.length > 0 || playlists_by_title.length > 0 || playlists_by_artist.length > 0;
    if (hasLocal) {
      return res.json({
        q,
        tracks,
        playlists_by_title,
        playlists_by_artist,
        artist_channels,
        local,
        decision: "local_only",
        ingestionTriggered,
      });
    }

    // Existing behavior: only YouTube fallback in the no-local-results branch.
    const videos = await youtubeSearchVideos(q);

    if (artist_channels.local.length === 0) {
      artist_channels.youtube = deriveYouTubeArtistChannelsFromVideos(videos);
      artist_channels.decision = "youtube_fallback";
    }

    return res.json({
      q,
      tracks,
      playlists_by_title,
      playlists_by_artist,
      artist_channels,
      local,
      youtube: {
        videos: videos.map((v) => ({
          id: v.videoId,
          title: v.title,
          channelTitle: v.channelTitle,
          thumbnailUrl: v.thumbUrl ?? null,
        })),
      },
      decision: "youtube_fallback",
      ingestionTriggered,
    });
  } catch {
    return res.status(500).json({ error: "Search resolve failed" });
  }
});

export default router;
