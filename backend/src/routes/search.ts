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
  upsertYoutubeChannelMapping,
  validateYouTubeChannelId,
} from "../services/artistResolver";
import { ingestArtistFromYouTubeByChannelId } from "../services/ingestArtistFromYouTube";

const router = Router();

const MIN_QUERY_CHARS = 2;
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

function normalizeQuery(input: unknown): string {
  return typeof input === "string" ? input.trim() : "";
}

function normalizeMode(input: unknown): ResolveMode {
  const value = typeof input === "string" ? input : "";
  if (value === "track" || value === "artist" || value === "album" || value === "generic") return value;
  return "generic";
}

export function isArtistQuery(q: string): boolean {
  const raw = normalizeQuery(q);
  if (raw.length < MIN_QUERY_CHARS) return false;

  const lower = raw.toLowerCase();
  const forbidden = ["-", "feat", "ft.", "remix", "official", "lyrics", "video"];
  for (const token of forbidden) {
    if (lower.includes(token)) return false;
  }

  const words = raw.split(/\s+/).filter(Boolean);
  if (words.length < 1 || words.length > 4) return false;

  // "all alphabetic" per spec
  // NOTE: Avoid Unicode property escapes (\p{L}) so this works with older TS targets.
  // Covers common Latin + Latin-1 Supplement letters (incl. č/ć/š/đ/ž).
  const alpha = /^[A-Za-zÀ-ÖØ-öø-ÿ]+$/;
  return words.every((w) => alpha.test(w));
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
    if (seen.has(p.id)) continue;
    seen.add(p.id);
    merged.push(p);
  }

  for (const p of byArtist) {
    if (seen.has(p.id)) continue;
    seen.add(p.id);
    merged.push(p);
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

async function findYoutubeChannelByArtistName(artistName: string): Promise<YoutubeChannelsRow | null> {
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

  if (error) {
    console.warn(LOG_PREFIX, "cache lookup failed", { artistName, code: error.code, message: error.message });
    return null;
  }

  const outId = typeof (data as any)?.youtube_channel_id === "string" ? String((data as any).youtube_channel_id).trim() : "";
  const outName = typeof (data as any)?.name === "string" ? String((data as any).name).trim() : "";
  const outThumb = typeof (data as any)?.thumbnail_url === "string" ? String((data as any).thumbnail_url) : null;
  if (!outId) return null;

  return { name: outName || name, youtube_channel_id: outId, thumbnail_url: outThumb };
}

async function runArtistIngestFlow(artistNameRaw: string): Promise<void> {
  const artistName = normalizeQuery(artistNameRaw);
  if (artistName.length < MIN_QUERY_CHARS) {
    console.info(LOG_PREFIX, "SKIP", { reason: "artistName_too_short", artistName });
    return;
  }
  if (!supabase) {
    console.info(LOG_PREFIX, "SKIP", { reason: "supabase_missing", artistName });
    return;
  }

  console.info(LOG_PREFIX, "START", { artistName });

  try {
    let channelId: string | null = null;

    const cached = await findYoutubeChannelByArtistName(artistName);
    if (cached?.youtube_channel_id) {
      channelId = cached.youtube_channel_id;
      console.info(LOG_PREFIX, "CACHE_HIT", { artistName, channelId });

      const validation = await validateYouTubeChannelId(channelId);
      console.info(LOG_PREFIX, "CHANNELS_LIST", { artistName, channelId, result: validation.status });

      if (validation.status === "invalid") {
        await deleteYoutubeChannelMappingByChannelId(channelId);
        console.info(LOG_PREFIX, "CACHE_DELETE_INVALID", { artistName, channelId });
        channelId = null;
      } else if (validation.status === "error") {
        console.warn(LOG_PREFIX, "CHANNELS_LIST_ERROR", { artistName, channelId, error: validation.error });
        return;
      }
    } else {
      console.info(LOG_PREFIX, "CACHE_MISS", { artistName });
    }

    if (!channelId) {
      console.info(LOG_PREFIX, "SEARCH_LIST_CALL", { artistName });
      const candidates = await youtubeSearchArtistChannel(artistName);
      const first = Array.isArray(candidates) ? candidates[0] : null;
      const candidateId = first?.channelId ? String(first.channelId).trim() : "";
      const candidateTitle = first?.title ? String(first.title).trim() : "";
      const candidateThumbUrl = first?.thumbUrl ? String(first.thumbUrl) : null;

      if (!candidateId) {
        console.warn(LOG_PREFIX, "SEARCH_LIST_EMPTY", { artistName, candidatesCount: Array.isArray(candidates) ? candidates.length : 0 });
        return;
      }

      const validation = await validateYouTubeChannelId(candidateId);
      console.info(LOG_PREFIX, "CHANNELS_LIST", { artistName, channelId: candidateId, result: validation.status, source: "search" });

      if (validation.status === "invalid") {
        console.warn(LOG_PREFIX, "CANDIDATE_INVALID", { artistName, channelId: candidateId });
        return;
      }
      if (validation.status === "error") {
        console.warn(LOG_PREFIX, "CHANNELS_LIST_ERROR", { artistName, channelId: candidateId, error: validation.error, source: "search" });
        return;
      }

      channelId = candidateId;
      await upsertYoutubeChannelMapping({
        name: artistName,
        youtube_channel_id: channelId,
        thumbnail_url: validation.thumbnailUrl ?? candidateThumbUrl ?? null,
      });

      console.info(LOG_PREFIX, "CACHE_UPSERT", {
        artistName,
        channelId,
        channelTitle: (validation.channelTitle ?? candidateTitle) || null,
      });
    }

    if (!channelId) {
      console.warn(LOG_PREFIX, "SKIP", { reason: "no_channelId", artistName });
      return;
    }

    const ingest = await ingestArtistFromYouTubeByChannelId({ youtube_channel_id: channelId, artistName });
    if (!ingest) {
      console.warn(LOG_PREFIX, "INGEST_FAILED", { artistName, channelId });
      return;
    }

    console.info(LOG_PREFIX, "COMPLETE", {
      artistName,
      channelId,
      playlists: ingest.playlists_ingested,
      tracks: ingest.tracks_ingested,
    });
  } catch (err: any) {
    console.warn(LOG_PREFIX, "ERROR", { artistName: normalizeQuery(artistNameRaw), message: err?.message ? String(err.message) : "unknown" });
  }
}

router.get("/suggest", async (req, res) => {
  const q = normalizeQuery(req.query.q);
  try {
    const result = await spotifySearch(q);
    return res.json({ q, source: "spotify", ...result });
  } catch (err: any) {
    console.warn("[SearchSuggest] ERROR", { q, message: err?.message ? String(err.message) : "unknown" });
    return res.status(500).json({ error: "Search suggest failed" });
  }
});

router.post("/resolve", async (req, res) => {
  const body = (req.body || {}) as ResolveRequestBody;
  const q = normalizeQuery(body.q);
  const mode = normalizeMode(body.mode);

  if (!supabase) {
    console.info(LOG_PREFIX, "SKIP", { reason: "supabase_missing", q, mode });
    return res.status(503).json({ error: "Search resolve unavailable" });
  }

  if (q.length < MIN_QUERY_CHARS) {
    console.info(LOG_PREFIX, "SKIP", { reason: "query_too_short", q, mode });
    const artist_channels: ArtistChannelsEnvelope = { local: [], youtube: [], decision: "local_only" };
    return res.json({
      q,
      tracks: [],
      playlists_by_title: [],
      playlists_by_artist: [],
      artist_channels,
      local: { tracks: [], playlists: [] },
      decision: "local_only",
      artist_ingested: false,
      artist_name: null,
    });
  }

  const artistCandidate = isArtistQuery(q);
  const artist_name = artistCandidate ? q : null;
  const artist_ingested = artistCandidate;

  if (artistCandidate) {
    console.info(LOG_PREFIX, "TRIGGER", { artistName: q, q, mode });
    // Fire-and-forget: do NOT block the search response.
    void runArtistIngestFlow(q);
  } else {
    console.info(LOG_PREFIX, "SKIP", { reason: "not_artist_query", q, mode });
  }

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
        artist_ingested,
        artist_name,
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
      artist_ingested,
      artist_name,
    });
  } catch (err: any) {
    console.warn("[SearchResolve] ERROR", { q, mode, message: err?.message ? String(err.message) : "unknown" });
    return res.status(500).json({ error: "Search resolve failed" });
  }
});

export default router;
