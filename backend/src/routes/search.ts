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
import { youtubeSearchArtistChannel } from "../services/youtubeClient";
import {
  deleteYoutubeChannelMappingByChannelId,
  upsertYoutubeChannelMapping,
  validateYouTubeChannelId,
} from "../services/artistResolver";
import { ingestArtistFromYouTubeByChannelId } from "../services/ingestArtistFromYouTube";

const router = Router();

const MIN_QUERY_CHARS = 2;
const LOG_PREFIX = "[ArtistIngest]";
const RESOLVE_LOG_PREFIX = "[SearchResolve]";

type ResolveMode = "track" | "artist" | "album" | "generic";

type ResolveRequestBody = {
  q?: unknown;
  mode?: unknown;
  spotify?: unknown;
};

type SpotifySelection =
  | { type: "artist"; id: string; name: string }
  | { type: "track"; id: string; name: string; artistName?: string }
  | { type: "album"; id: string; name: string; artistName?: string }
  | { type: "playlist"; id: string; name: string; ownerName?: string };

function normalizeSpotifySelection(value: unknown): SpotifySelection | null {
  if (!value || typeof value !== "object") return null;
  const type = (value as any).type;
  const id = normalizeQuery((value as any).id);
  const name = normalizeQuery((value as any).name);
  if (!id || !name) return null;

  if (type === "artist") return { type: "artist", id, name };
  if (type === "track") return { type: "track", id, name, artistName: normalizeQuery((value as any).artistName) || undefined };
  if (type === "album") return { type: "album", id, name, artistName: normalizeQuery((value as any).artistName) || undefined };
  if (type === "playlist") return { type: "playlist", id, name, ownerName: normalizeQuery((value as any).ownerName) || undefined };
  return null;
}

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

function computeMinimums(opts: {
  mode: ResolveMode;
  spotify: SpotifySelection | null;
}): { minTracks: number; minPlaylists: number } {
  // User-confirmed rule:
  // - playlist queries: 10 tracks / 5 playlists
  // - track/album queries: 10 tracks / 5 playlists
  // - artist: "do 3" (interpreted here as min 3 tracks, 0 playlists)
  const kind = opts.spotify?.type ?? opts.mode;
  if (kind === "artist") return { minTracks: 3, minPlaylists: 0 };
  if (kind === "track" || kind === "album" || kind === "playlist") return { minTracks: 10, minPlaylists: 5 };
  return { minTracks: 0, minPlaylists: 0 };
}

function resolveArtistNameForIngest(opts: {
  q: string;
  mode: ResolveMode;
  spotify: SpotifySelection | null;
}): string | null {
  if (opts.spotify?.type === "artist") return normalizeQuery(opts.spotify.name) || null;
  if (opts.spotify?.type === "track" || opts.spotify?.type === "album") {
    return normalizeQuery(opts.spotify.artistName) || null;
  }
  if (opts.mode === "artist") return normalizeQuery(opts.q) || null;
  if (isArtistQuery(opts.q)) return normalizeQuery(opts.q) || null;
  return null;
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
  const spotify = normalizeSpotifySelection(body.spotify);

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

  try {
    const minimums = computeMinimums({ mode, spotify });
    const ingestArtistName = resolveArtistNameForIngest({ q, mode, spotify });

    const fetchLocal = async () => {
      const [trackRows, playlistsDual, artistChannelRows] = await Promise.all([
        searchTracksForQuery(q),
        searchPlaylistsDualForQuery(q),
        searchArtistChannelsForQuery(q),
      ]);

      const tracks = trackRows.map(mapTrackRow);
      const playlists_by_title = playlistsDual.playlists_by_title.map(mapPlaylistRow);
      const playlists_by_artist = playlistsDual.playlists_by_artist.map(mapPlaylistRow);
      const mergedPlaylists = mergeLegacyPlaylists(playlists_by_title, playlists_by_artist);

      const artistChannelsLocal = artistChannelRows
        .map(mapLocalArtistChannelRow)
        .filter((x): x is ResolvedArtistChannel => Boolean(x));

      const artist_channels: ArtistChannelsEnvelope = {
        local: artistChannelsLocal,
        youtube: [],
        decision: "local_only",
      };

      return {
        tracks,
        playlists_by_title,
        playlists_by_artist,
        local: { tracks, playlists: mergedPlaylists },
        artist_channels,
      };
    };

    const before = await fetchLocal();

    const missingTracks = Math.max(0, minimums.minTracks - before.local.tracks.length);
    const missingPlaylists = Math.max(0, minimums.minPlaylists - before.local.playlists.length);

    console.info(RESOLVE_LOG_PREFIX, "LOCAL_COUNTS", {
      q,
      mode,
      spotifyType: spotify?.type ?? null,
      minTracks: minimums.minTracks,
      minPlaylists: minimums.minPlaylists,
      tracks: before.local.tracks.length,
      playlists: before.local.playlists.length,
      missingTracks,
      missingPlaylists,
      ingestArtistName,
    });

    let artist_ingested = false;
    const artist_name = ingestArtistName;

    if ((missingTracks > 0 || missingPlaylists > 0) && ingestArtistName) {
      console.info(RESOLVE_LOG_PREFIX, "INGEST_NEEDED", { q, mode, ingestArtistName, missingTracks, missingPlaylists });

      // Resolve channelId via the existing strict flow (cache -> validate -> search.list).
      let channelId: string | null = null;

      const cached = await findYoutubeChannelByArtistName(ingestArtistName);
      if (cached?.youtube_channel_id) {
        channelId = cached.youtube_channel_id;
        console.info(LOG_PREFIX, "CACHE_HIT", { artistName: ingestArtistName, channelId });

        const validation = await validateYouTubeChannelId(channelId);
        console.info(LOG_PREFIX, "CHANNELS_LIST", { artistName: ingestArtistName, channelId, result: validation.status });

        if (validation.status === "invalid") {
          await deleteYoutubeChannelMappingByChannelId(channelId);
          console.info(LOG_PREFIX, "CACHE_DELETE_INVALID", { artistName: ingestArtistName, channelId });
          channelId = null;
        } else if (validation.status === "error") {
          console.warn(LOG_PREFIX, "CHANNELS_LIST_ERROR", { artistName: ingestArtistName, channelId, error: validation.error });
          channelId = null;
        }
      }

      if (!channelId) {
        console.info(LOG_PREFIX, "SEARCH_LIST_CALL", { artistName: ingestArtistName });
        const candidates = await youtubeSearchArtistChannel(ingestArtistName);
        const first = Array.isArray(candidates) ? candidates[0] : null;
        const candidateId = first?.channelId ? String(first.channelId).trim() : "";
        const candidateTitle = first?.title ? String(first.title).trim() : "";
        const candidateThumbUrl = first?.thumbUrl ? String(first.thumbUrl) : null;

        if (candidateId) {
          const validation = await validateYouTubeChannelId(candidateId);
          console.info(LOG_PREFIX, "CHANNELS_LIST", { artistName: ingestArtistName, channelId: candidateId, result: validation.status, source: "search" });

          if (validation.status === "valid") {
            channelId = candidateId;
            await upsertYoutubeChannelMapping({
              name: ingestArtistName,
              youtube_channel_id: channelId,
              thumbnail_url: validation.thumbnailUrl ?? candidateThumbUrl ?? null,
            });

            console.info(LOG_PREFIX, "CACHE_UPSERT", {
              artistName: ingestArtistName,
              channelId,
              channelTitle: (validation.channelTitle ?? candidateTitle) || null,
            });
          }
        }
      }

      if (channelId) {
        const ingest = await ingestArtistFromYouTubeByChannelId({
          youtube_channel_id: channelId,
          artistName: ingestArtistName,
          max_playlists: missingPlaylists > 0 ? missingPlaylists : 0,
          max_tracks: missingTracks > 0 ? missingTracks : 0,
        });
        if (ingest) {
          artist_ingested = true;
          console.info(RESOLVE_LOG_PREFIX, "INGEST_COMPLETE", {
            q,
            mode,
            ingestArtistName,
            channelId,
            playlistsIngested: ingest.playlists_ingested,
            tracksIngested: ingest.tracks_ingested,
          });
        } else {
          console.warn(RESOLVE_LOG_PREFIX, "INGEST_FAILED", { q, mode, ingestArtistName, channelId });
        }
      } else {
        console.warn(RESOLVE_LOG_PREFIX, "INGEST_SKIPPED", { q, mode, ingestArtistName, reason: "no_channelId" });
      }
    } else {
      if (missingTracks > 0 || missingPlaylists > 0) {
        console.info(RESOLVE_LOG_PREFIX, "INGEST_SKIPPED", { q, mode, reason: "no_artist_for_ingest", missingTracks, missingPlaylists });
      }
    }

    const after = (missingTracks > 0 || missingPlaylists > 0) ? await fetchLocal() : before;

    console.info(RESOLVE_LOG_PREFIX, "FINAL_COUNTS", {
      q,
      mode,
      tracks: after.local.tracks.length,
      playlists: after.local.playlists.length,
    });

    return res.json({
      q,
      tracks: after.tracks,
      playlists_by_title: after.playlists_by_title,
      playlists_by_artist: after.playlists_by_artist,
      artist_channels: after.artist_channels,
      local: after.local,
      decision: "local_only",
      artist_ingested,
      artist_name,
    });
  } catch (err: any) {
    console.warn("[SearchResolve] ERROR", { q, mode, message: err?.message ? String(err.message) : "unknown" });
    return res.status(500).json({ error: "Search resolve failed" });
  }
});

export default router;
