import { Router } from "express";

import supabase, {
  searchArtistChannelsForQuery,
  searchPlaylistsDualForQuery,
  searchTracksForQuery,
  type SearchArtistChannelRow,
  type SearchPlaylistRow,
  type SearchTrackRow,
} from "../services/supabaseClient";
import { youtubeSearchArtistChannel } from "../services/youtubeClient";
import { youtubeSuggest } from "../services/youtubeSuggest";
import { youtubeSearchMixed } from "../services/youtubeClient";
import { youtubeFetchPlaylistTracks } from "../services/youtubeFetchPlaylistTracks";
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

const MAX_ARTISTS = 3;
const MIN_TRACKS = 8;
const MAX_TRACKS = 8;
const MIN_PLAYLISTS = 8;
const MAX_PLAYLISTS = 8;

type ResolveMode = "track" | "artist" | "album" | "generic";

type ResolveRequestBody = {
  q?: unknown;
  mode?: unknown;
  spotify?: unknown;
};

type SpotifySelection = unknown;

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
  if (!title || !channelId) return null;
  return { channelId, title, thumbnailUrl: null };
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
    .select("name, youtube_channel_id")
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
  if (!outId) return null;

  return { name: outName || name, youtube_channel_id: outId };
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
}): { minTracks: number; maxTracks: number; minPlaylists: number; maxPlaylists: number } {
  void opts;
  return {
    minTracks: MIN_TRACKS,
    maxTracks: MAX_TRACKS,
    minPlaylists: MIN_PLAYLISTS,
    maxPlaylists: MAX_PLAYLISTS,
  };
}

function resolveArtistNameForIngest(opts: {
  q: string;
  mode: ResolveMode;
  spotify: SpotifySelection | null;
}): string | null {
  if (opts.mode === "artist") return normalizeQuery(opts.q) || null;
  if (isArtistQuery(opts.q)) return normalizeQuery(opts.q) || null;
  return null;
}

type YouTubeMixedChannel = { channelId: string; title: string; thumbUrl?: string };
type YouTubeMixedVideo = { videoId: string; title: string; channelId: string; channelTitle: string; thumbUrl?: string };
type YouTubeMixedPlaylist = { playlistId: string; title: string; channelId: string; channelTitle: string; thumbUrl?: string };

async function persistYouTubeMixedResults(opts: {
  q: string;
  channels: YouTubeMixedChannel[];
  videos: YouTubeMixedVideo[];
  playlists: YouTubeMixedPlaylist[];
}): Promise<{ playlists: Array<{ id: string; external_id: string }> }> {
  if (!supabase) return { playlists: [] };

  // 1) Cache channelId mappings.
  if (opts.channels.length > 0) {
    for (const ch of opts.channels) {
      const name = normalizeQuery(ch.title);
      const youtube_channel_id = normalizeQuery(ch.channelId);
      if (!name || !youtube_channel_id) continue;
      await upsertYoutubeChannelMapping({ name, youtube_channel_id });
    }
  }

  // 2) Upsert lightweight track rows (for local-first UI; full hydration happens later).
  if (opts.videos.length > 0) {
    const trackRows = opts.videos
      .map((v) => {
        const external_id = normalizeQuery(v.videoId);
        const title = normalizeQuery(v.title);
        if (!external_id || !title) return null;
        const channelTitle = normalizeQuery(v.channelTitle);
        const artistFallback = isArtistQuery(opts.q) ? normalizeQuery(opts.q) : channelTitle;

        return {
          source: "youtube" as const,
          external_id,
          youtube_id: external_id,
          title,
          artist: artistFallback || null,
          cover_url: v.thumbUrl ?? null,
          artist_channel_id: normalizeQuery(v.channelId) || null,
          duration: null,
        };
      })
      .filter((x): x is NonNullable<typeof x> => Boolean(x));

    if (trackRows.length > 0) {
      // Best-effort: environments may restrict columns; rely on existing schema.
      try {
        await supabase.from("tracks").upsert(trackRows as any, { onConflict: "external_id" });
      } catch {
        // ignore
      }
    }
  }

  // 3) Upsert lightweight playlist rows.
  let playlistRowsOut: Array<{ id: string; external_id: string }> = [];
  if (opts.playlists.length > 0) {
    const playlistRows = opts.playlists
      .map((p) => {
        const external_id = normalizeQuery(p.playlistId);
        const title = normalizeQuery(p.title);
        const channel_id = normalizeQuery(p.channelId);
        const channel_title = normalizeQuery(p.channelTitle);
        if (!external_id || !title) return null;
        return {
          external_id,
          title,
          description: null,
          cover_url: p.thumbUrl ?? null,
          channel_id: channel_id || null,
          channel_title: channel_title || null,
          item_count: null,
          sync_status: "fetched",
        };
      })
      .filter((x): x is NonNullable<typeof x> => Boolean(x));

    if (playlistRows.length > 0) {
      try {
        const { data } = await supabase
          .from("playlists")
          .upsert(playlistRows as any, { onConflict: "external_id" })
          .select("id, external_id");
        const rows = Array.isArray(data) ? (data as any[]) : [];
        playlistRowsOut = rows
          .map((r) => ({ id: String(r.id), external_id: String(r.external_id) }))
          .filter((r) => r.id && r.external_id);
      } catch {
        // ignore
      }
    }
  }

  return { playlists: playlistRowsOut };
}

router.get("/suggest", async (req, res) => {
  const q = normalizeQuery(req.query.q);
  try {
    const suggestions = await youtubeSuggest(q);
    return res.json({ q, source: "youtube_suggest", suggestions });
  } catch (err: any) {
    console.warn("[SearchSuggest] ERROR", { q, message: err?.message ? String(err.message) : "unknown" });
    return res.status(500).json({ error: "Search suggest failed" });
  }
});

router.post("/resolve", async (req, res) => {
  const body = (req.body || {}) as ResolveRequestBody;
  const q = normalizeQuery(body.q);
  const mode = normalizeMode(body.mode);
  const spotify = null;

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
      const mergedPlaylists = mergeLegacyPlaylists(playlists_by_title, playlists_by_artist).slice(0, MAX_PLAYLISTS);

      const artistChannelsLocal = artistChannelRows
        .map(mapLocalArtistChannelRow)
        .filter((x): x is ResolvedArtistChannel => Boolean(x))
        .slice(0, MAX_ARTISTS);

      const artist_channels: ArtistChannelsEnvelope = {
        local: artistChannelsLocal,
        youtube: [],
        decision: "local_only",
      };

      return {
        tracks: tracks.slice(0, MAX_TRACKS),
        playlists_by_title,
        playlists_by_artist,
        local: { tracks: tracks.slice(0, MAX_TRACKS), playlists: mergedPlaylists },
        artist_channels,
      };
    };

    const before = await fetchLocal();

    const missingTracks = Math.max(0, minimums.minTracks - before.local.tracks.length);
    const missingPlaylists = Math.max(0, minimums.minPlaylists - before.local.playlists.length);
    const missingArtists = Math.max(0, MAX_ARTISTS - before.artist_channels.local.length);

    console.info(RESOLVE_LOG_PREFIX, "LOCAL_COUNTS", {
      q,
      mode,
      spotifyType: null,
      minTracks: minimums.minTracks,
      maxTracks: minimums.maxTracks,
      minPlaylists: minimums.minPlaylists,
      maxPlaylists: minimums.maxPlaylists,
      tracks: before.local.tracks.length,
      playlists: before.local.playlists.length,
      artists: before.artist_channels.local.length,
      missingTracks,
      missingPlaylists,
      missingArtists,
      ingestArtistName,
    });

    let artist_ingested = false;
    const artist_name = ingestArtistName;

    if ((missingTracks > 0 || missingPlaylists > 0 || missingArtists > 0) && ingestArtistName) {
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
        // NOTE: Click-only backfill. We do EXACTLY ONE search.list call and persist IDs immediately.
        console.info(LOG_PREFIX, "SEARCH_LIST_CALL", { q: ingestArtistName });

        const mixed = await youtubeSearchMixed(ingestArtistName);
        await persistYouTubeMixedResults({
          q: ingestArtistName,
          channels: mixed.channels as any,
          videos: mixed.videos as any,
          playlists: mixed.playlists as any,
        });

        const first = Array.isArray(mixed.channels) ? mixed.channels[0] : null;
        const candidateId = first?.channelId ? String(first.channelId).trim() : "";
        const candidateTitle = first?.title ? String(first.title).trim() : "";

        if (candidateId) {
          const validation = await validateYouTubeChannelId(candidateId);
          console.info(LOG_PREFIX, "CHANNELS_LIST", {
            artistName: ingestArtistName,
            channelId: candidateId,
            result: validation.status,
            source: "search_mixed",
          });

          if (validation.status === "valid") {
            channelId = candidateId;
            await upsertYoutubeChannelMapping({
              name: ingestArtistName,
              youtube_channel_id: channelId,
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
        const maxPlaylistsForIngest = missingPlaylists > 0 ? missingPlaylists : missingTracks > 0 ? 1 : 0;
        const ingest = await ingestArtistFromYouTubeByChannelId({
          youtube_channel_id: channelId,
          artistName: ingestArtistName,
          max_playlists: maxPlaylistsForIngest,
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
    } else if (missingTracks > 0 || missingPlaylists > 0 || missingArtists > 0) {
      if (missingTracks > 0 || missingPlaylists > 0) {
        console.info(RESOLVE_LOG_PREFIX, "INGEST_SKIPPED", { q, mode, reason: "no_artist_for_ingest", missingTracks, missingPlaylists });
      }

      // General (non-artist) query backfill:
      // - ONE youtube.search.list call
      // - persist channel/video/playlist IDs immediately
      // - then hydrate via existing playlist/tracks fetchers
      console.info(RESOLVE_LOG_PREFIX, "SEARCH_LIST_BACKFILL", { q, missingTracks, missingPlaylists, missingArtists });

      const mixed = await youtubeSearchMixed(q);
      const persisted = await persistYouTubeMixedResults({
        q,
        channels: mixed.channels as any,
        videos: mixed.videos as any,
        playlists: mixed.playlists as any,
      });

      // Hydrate tracks via playlist fetch (best-effort, quota-light vs repeated search.list).
      let remainingTracks = missingTracks;
      for (const p of persisted.playlists) {
        if (remainingTracks <= 0) break;
        const inserted = await youtubeFetchPlaylistTracks({
          playlist_id: p.id,
          external_playlist_id: p.external_id,
          max_tracks: remainingTracks,
          artist_override: ingestArtistName ?? undefined,
        });
        if (inserted === null) break;
        remainingTracks = Math.max(0, remainingTracks - inserted);
      }
    }

    const after = (missingTracks > 0 || missingPlaylists > 0 || missingArtists > 0) ? await fetchLocal() : before;

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
