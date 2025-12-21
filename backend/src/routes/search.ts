import { Router } from "express";

import supabase, {
  searchArtistChannelsForQuery,
  searchPlaylistsDualForQuery,
  searchTracksForQuery,
  type SearchArtistChannelRow,
  type SearchPlaylistRow,
  type SearchTrackRow,
} from "../services/supabaseClient";
import { youtubeSearchArtistChannel, YouTubeQuotaExceededError } from "../services/youtubeClient";
import { youtubeSearchMixed } from "../services/youtubeClient";
import { youtubeBatchFetchPlaylists } from "../services/youtubeBatchFetchPlaylists";
import { spotifySearch, SpotifyRateLimitedError } from "../services/spotifyClient";
import { isOlakPlaylistId } from "../utils/olak";
import {
  deleteYoutubeChannelMappingByChannelId,
  deriveArtistKey,
  upsertYoutubeChannelMapping,
  validateYouTubeChannelId,
} from "../services/artistResolver";
import { ingestArtistFromYouTubeByChannelId } from "../services/ingestArtistFromYouTube";
import { getIngestMap, type IngestEntry } from "../lib/ingestLock";
import { normalizeArtistKey } from "../utils/artistKey";

const router = Router();

const MIN_QUERY_CHARS = 2;
const LOG_PREFIX = "[ArtistIngest]";
const RESOLVE_LOG_PREFIX = "[SearchResolve]";
const SUGGEST_LOG_PREFIX = "[SearchSuggest]";

const SUGGEST_CACHE_TTL_MS = 60_000;
const SUGGEST_CACHE_MAX = 500;
type SuggestionType = "artist" | "track" | "playlist" | "album";
type SuggestionItem = {
  type: SuggestionType;
  id: string;
  name: string;
  imageUrl?: string;
  subtitle?: string;
  artists?: string[];
};

type SuggestEnvelope = {
  q: string;
  source: "spotify_suggest" | "local_fallback";
  suggestions: SuggestionItem[];
};

type SuggestCacheEntry = { expiresAtMs: number; value: SuggestEnvelope };
const suggestCache = new Map<string, SuggestCacheEntry>();

function normalizeSuggestKey(raw: unknown): string {
  return normalizeQuery(raw).toLowerCase();
}

function pruneSuggestCache(now: number): void {
  // Drop expired.
  const expiredKeys: string[] = [];
  suggestCache.forEach((v, k) => {
    if (v.expiresAtMs <= now) expiredKeys.push(k);
  });
  for (const k of expiredKeys) suggestCache.delete(k);
  // Enforce cap (best-effort FIFO since Map iterates insertion order).
  while (suggestCache.size > SUGGEST_CACHE_MAX) {
    const firstKey = suggestCache.keys().next().value as string | undefined;
    if (!firstKey) break;
    suggestCache.delete(firstKey);
  }
}

function cacheSuggest(key: string, value: SuggestEnvelope): void {
  const now = Date.now();
  pruneSuggestCache(now);
  suggestCache.set(key, { expiresAtMs: now + SUGGEST_CACHE_TTL_MS, value });
  // If we just exceeded cap due to insertion, trim again.
  pruneSuggestCache(now);
}

function getCachedSuggest(key: string): SuggestEnvelope | null {
  const now = Date.now();
  const entry = suggestCache.get(key);
  if (!entry) return null;
  if (entry.expiresAtMs <= now) {
    suggestCache.delete(key);
    return null;
  }
  return entry.value;
}

async function buildLocalFallbackSuggestions(q: string): Promise<SuggestionItem[]> {
  if (!supabase) return [];

  const isArtist = isArtistQuery(q);

  const [trackRows, playlistsDual, artistChannelRows] = await Promise.all([
    searchTracksForQuery(q, { limit: isArtist ? 20 : 8, prioritizeArtistMatch: isArtist }),
    searchPlaylistsDualForQuery(q, { limit: isArtist ? 20 : 8 }),
    searchArtistChannelsForQuery(q),
  ]);

  const out: SuggestionItem[] = [];

  for (const row of trackRows) {
    const title = typeof row.title === "string" ? row.title.trim() : "";
    const artist = typeof row.artist === "string" ? row.artist.trim() : "";
    if (!title) continue;
    out.push({
      type: "track",
      id: String(row.id),
      name: title,
      imageUrl: typeof (row as any)?.cover_url === "string" ? String((row as any).cover_url) : undefined,
      subtitle: artist || undefined,
      artists: artist ? [artist] : undefined,
    });
  }

  const playlistCandidates = mergeLegacyPlaylists(
    playlistsDual.playlists_by_title.map(mapPlaylistRow),
    playlistsDual.playlists_by_artist.map(mapPlaylistRow),
  )
    .filter((p) => !isOlakPlaylistId(p.externalId))
    .slice(0, isArtist ? 20 : 8);

  for (const p of playlistCandidates) {
    const title = typeof p.title === "string" ? p.title.trim() : "";
    if (!title) continue;
    out.push({
      type: "playlist",
      id: String(p.id),
      name: title,
      imageUrl: p.coverUrl || undefined,
    });
  }

  for (const a of artistChannelRows.slice(0, 5)) {
    const name = typeof a.name === "string" ? a.name.trim() : "";
    const channelId = typeof a.youtube_channel_id === "string" ? a.youtube_channel_id.trim() : "";
    if (!name || !channelId) continue;
    out.push({ type: "artist", id: channelId, name });
  }

  // De-dupe by type + id.
  const seen = new Set<string>();
  return out.filter((s) => {
    const k = `${s.type}:${s.id}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

const BACKFILL_DEDUP_MS = 60_000;
const backfillInFlight = new Map<string, number>();

function shouldStartBackfill(key: string, ttlMs: number = BACKFILL_DEDUP_MS): { start: boolean; ageMs: number | null } {
  const now = Date.now();
  const last = backfillInFlight.get(key);
  const ageMs = typeof last === "number" ? Math.max(0, now - last) : null;
  if (typeof last === "number" && now - last < ttlMs) return { start: false, ageMs };
  backfillInFlight.set(key, now);
  // Best-effort cleanup.
  if (backfillInFlight.size > 500) {
    backfillInFlight.forEach((ts, k) => {
      if (now - ts > BACKFILL_DEDUP_MS) backfillInFlight.delete(k);
    });
  }
  return { start: true, ageMs };
}

const MAX_ARTISTS = 3;
const MIN_TRACKS = 1;
const MAX_TRACKS = 8;
const MIN_PLAYLISTS = 8;
const MAX_PLAYLISTS = 8;

// Higher limits for artist-specific searches
const ARTIST_MAX_TRACKS = 50;
const ARTIST_MAX_PLAYLISTS = 50;

type ResolveMode = "track" | "artist" | "album" | "generic";

type ResolveRequestBody = {
  q?: unknown;
  mode?: unknown;
  spotify?: unknown;
  sync?: unknown;
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

type ResolvedArtistMedia = {
  name: string;
  youtube_channel_id: string | null;
  thumbnail_url: string | null;
  banner_url: string | null;
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
  // NOTE: We intentionally do NOT forbid '-' globally, because many valid artist names contain it
  // (e.g. AC-DC, Jay-Z). We'll treat separators as whitespace below.
  const forbidden = ["feat", "ft.", "remix", "official", "lyrics", "video"];
  for (const token of forbidden) {
    if (lower.includes(token)) return false;
  }

  // Treat common artist separators as whitespace so names like "AC/DC" become "AC DC".
  const cleaned = raw.replace(/[\/-]+/g, " ");
  const words = cleaned.split(/\s+/).filter(Boolean);
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

async function loadArtistMediaByName(artistNameRaw: string): Promise<ResolvedArtistMedia | null> {
  if (!supabase) return null;
  const name = normalizeQuery(artistNameRaw);
  if (!name) return null;

  const key = deriveArtistKey(name);
  if (!key) return null;

  const { data, error } = await supabase
    .from("artists")
    .select("artist, youtube_channel_id, thumbnail_url, banner_url")
    .eq("artist_key", key)
    .limit(1)
    .maybeSingle();

  if (error) {
    console.warn("[SearchResolve] artists lookup failed", { artistName: name, code: error.code, message: error.message });
    return null;
  }

  const artist = typeof (data as any)?.artist === "string" ? String((data as any).artist).trim() : "";
  const youtube_channel_id = typeof (data as any)?.youtube_channel_id === "string" ? String((data as any).youtube_channel_id).trim() : "";
  const thumb = typeof (data as any)?.thumbnail_url === "string" ? String((data as any).thumbnail_url).trim() : "";
  const banner = typeof (data as any)?.banner_url === "string" ? String((data as any).banner_url).trim() : "";

  return {
    name: artist || name,
    youtube_channel_id: youtube_channel_id || null,
    thumbnail_url: thumb || null,
    banner_url: banner || null,
  };
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
      try {
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
      } catch (err: any) {
        if (err instanceof YouTubeQuotaExceededError) {
          console.error(LOG_PREFIX, "QUOTA_EXCEEDED", { artistName, message: err.message });
          return;
        }
        throw err;
      }
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

async function runSearchResolveBackfill(opts: {
  q: string;
  mode: ResolveMode;
  ingestArtistName: string | null;
  missingTracks: number;
  missingPlaylists: number;
  missingArtists: number;
  forceArtistIngest?: boolean;
}): Promise<void> {
  if (!supabase) return;

  const q = normalizeQuery(opts.q);
  const mode = opts.mode;
  const ingestArtistName = opts.ingestArtistName ? normalizeQuery(opts.ingestArtistName) : null;
  const missingTracks = Math.max(0, Number(opts.missingTracks) || 0);
  const missingPlaylists = Math.max(0, Number(opts.missingPlaylists) || 0);
  const missingArtists = Math.max(0, Number(opts.missingArtists) || 0);
  const forceArtistIngest = Boolean(opts.forceArtistIngest);

  try {
    if ((missingTracks > 0 || missingPlaylists > 0 || missingArtists > 0 || forceArtistIngest) && ingestArtistName) {
      // Artist ingest/backfill: resolve channelId then ingest with bounded limits.
      console.info(RESOLVE_LOG_PREFIX, "INGEST_NEEDED", { q, mode, ingestArtistName, missingTracks, missingPlaylists });

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
        console.info(LOG_PREFIX, "SEARCH_LIST_CALL", { q: ingestArtistName });
        try {
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
        } catch (err: any) {
          if (err instanceof YouTubeQuotaExceededError) {
            console.error(RESOLVE_LOG_PREFIX, "QUOTA_EXCEEDED", {
              q,
              mode,
              ingestArtistName,
              message: err.message,
            });
          } else {
            console.warn(RESOLVE_LOG_PREFIX, "SEARCH_LIST_FAILED", {
              q,
              mode,
              ingestArtistName,
              message: err?.message ? String(err.message) : "unknown",
            });
          }
        }
      }

      if (channelId) {
        const max_playlists =
          missingPlaylists > 0 ? missingPlaylists :
          missingTracks > 0 ? 1 :
          (missingArtists > 0 || forceArtistIngest) ? 10 :
          undefined;

        const max_tracks =
          missingTracks > 0 ? missingTracks :
          (missingArtists > 0 || forceArtistIngest) ? 50 :
          undefined;

        const ingest = await ingestArtistFromYouTubeByChannelId({
          youtube_channel_id: channelId,
          artistName: ingestArtistName,
          max_playlists,
          max_tracks,
        });

        if (ingest) {
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

      return;
    }

    if (missingTracks > 0 || missingPlaylists > 0 || missingArtists > 0) {
      console.info(RESOLVE_LOG_PREFIX, "SEARCH_LIST_BACKFILL", { q, missingTracks, missingPlaylists, missingArtists });
      try {
        const mixed = await youtubeSearchMixed(q);
        const persisted = await persistYouTubeMixedResults({
          q,
          channels: mixed.channels as any,
          videos: mixed.videos as any,
          playlists: mixed.playlists as any,
        });

        await youtubeBatchFetchPlaylists(
          persisted.playlists.map((p) => ({
            playlist_id: p.id,
            external_playlist_id: p.external_id,
            artist_override: ingestArtistName ?? undefined,
          })),
          { max_total_tracks: missingTracks },
        );
      } catch (err: any) {
        if (err instanceof YouTubeQuotaExceededError) {
          console.error(RESOLVE_LOG_PREFIX, "QUOTA_EXCEEDED", {
            q,
            mode,
            message: err.message,
          });
        } else {
          console.warn(RESOLVE_LOG_PREFIX, "SEARCH_LIST_FAILED", {
            q,
            mode,
            message: err?.message ? String(err.message) : "unknown",
          });
        }
      }
    }
  } catch (err: any) {
    console.warn(RESOLVE_LOG_PREFIX, "ERROR", { q, mode, message: err?.message ? String(err.message) : "unknown" });
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
        if (isOlakPlaylistId(external_id)) return null;
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
  const key = normalizeSuggestKey(q);

  if (key.length >= MIN_QUERY_CHARS) {
    const cached = getCachedSuggest(key);
    if (cached) {
      console.info(SUGGEST_LOG_PREFIX, "CACHE_HIT", { q, key, source: cached.source, size: suggestCache.size });
      return res.json(cached);
    }
    console.info(SUGGEST_LOG_PREFIX, "CACHE_MISS", { q, key, size: suggestCache.size });
  }

  try {
    // Autocomplete: MUST NOT call YouTube.
    // Primary path uses Spotify; fallback uses Supabase only.
    const result = await spotifySearch(q);

    const suggestions: SuggestionItem[] = [];

    for (const a of result.artists) {
      suggestions.push({ type: "artist", id: a.id, name: a.name, imageUrl: a.imageUrl });
    }

    for (const t of result.tracks) {
      const artists = Array.isArray((t as any).artistNames) ? ((t as any).artistNames as string[]) : [];
      const subtitle = artists.length > 0 ? artists.join(", ") : t.artistName ? t.artistName : undefined;
      suggestions.push({ type: "track", id: t.id, name: t.name, imageUrl: t.imageUrl, subtitle, artists: artists.length > 0 ? artists : undefined });
    }

    for (const p of result.playlists) {
      const subtitle = p.ownerName ? p.ownerName : undefined;
      suggestions.push({ type: "playlist", id: p.id, name: p.name, imageUrl: p.imageUrl, subtitle });
    }

    for (const a of result.albums) {
      const subtitle = a.artistName ? a.artistName : undefined;
      suggestions.push({ type: "album", id: a.id, name: a.name, imageUrl: a.imageUrl, subtitle });
    }

    const payload: SuggestEnvelope = { q, source: "spotify_suggest", suggestions };
    if (key.length >= MIN_QUERY_CHARS) cacheSuggest(key, payload);
    return res.json(payload);
  } catch (err: any) {
    const rateLimited = err instanceof SpotifyRateLimitedError;
    console.warn(SUGGEST_LOG_PREFIX, rateLimited ? "SPOTIFY_429" : "SPOTIFY_FAILED", {
      q,
      message: err?.message ? String(err.message) : "unknown",
      retryAfterMs: rateLimited ? err.retryAfterMs : null,
    });

    let suggestions: SuggestionItem[] = [];
    try {
      suggestions = await buildLocalFallbackSuggestions(q);
    } catch (fallbackErr: any) {
      console.warn(SUGGEST_LOG_PREFIX, "FALLBACK_FAILED", {
        q,
        message: fallbackErr?.message ? String(fallbackErr.message) : "unknown",
      });
      // Keep suggestions empty; still return 200 with local_fallback.
      suggestions = [];
    }

    const payload: SuggestEnvelope = { q, source: "local_fallback", suggestions };
    if (key.length >= MIN_QUERY_CHARS) cacheSuggest(key, payload);
    return res.json(payload);
  }
});

router.post("/resolve", async (req, res) => {
  const body = (req.body || {}) as ResolveRequestBody;
  const q = normalizeQuery(body.q);
  const mode = normalizeMode(body.mode);
  const spotify = null;
  const sync = Boolean((body as any)?.sync);

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
    const isArtist = Boolean(ingestArtistName);

    // Use higher limits for artist queries
    const trackLimit = isArtist ? ARTIST_MAX_TRACKS : MAX_TRACKS;
    const playlistLimit = isArtist ? ARTIST_MAX_PLAYLISTS : MAX_PLAYLISTS;

    const fetchLocal = async () => {
      const [trackRows, playlistsDual, artistChannelRows] = await Promise.all([
        searchTracksForQuery(q, { limit: trackLimit, prioritizeArtistMatch: isArtist }),
        searchPlaylistsDualForQuery(q, { limit: playlistLimit }),
        searchArtistChannelsForQuery(q),
      ]);

      const tracks = trackRows.map(mapTrackRow);
      const playlists_by_title = playlistsDual.playlists_by_title
        .map(mapPlaylistRow)
        .filter((p) => !isOlakPlaylistId(p.externalId));
      const playlists_by_artist = playlistsDual.playlists_by_artist
        .map(mapPlaylistRow)
        .filter((p) => !isOlakPlaylistId(p.externalId));
      const mergedPlaylists = mergeLegacyPlaylists(playlists_by_title, playlists_by_artist).slice(0, playlistLimit);

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
        tracks: tracks.slice(0, trackLimit),
        playlists_by_title,
        playlists_by_artist,
        local: { tracks: tracks.slice(0, trackLimit), playlists: mergedPlaylists },
        artist_channels,
      };
    };

    const [before, ingestArtistMedia] = await Promise.all([
      fetchLocal(),
      ingestArtistName ? loadArtistMediaByName(ingestArtistName) : Promise.resolve(null),
    ]);

    const missingTracks = Math.max(0, minimums.minTracks - before.local.tracks.length);
    const missingPlaylists = Math.max(0, minimums.minPlaylists - before.local.playlists.length);
    const missingArtists = Math.max(0, MAX_ARTISTS - before.artist_channels.local.length);

    // Strict architecture rule:
    // - For generic/artist modes: if we have ANY local data to render, do not ingest.
    // - For track mode: allow ingest when there are no local tracks, even if playlists exist.
    // - If the artist exists in Supabase (artists row found), do not ingest.
    const hasRenderableLocal = mode === "track" ? before.local.tracks.length > 0 : (before.local.tracks.length > 0 || before.local.playlists.length > 0);
    const artistExistsInDb = Boolean(ingestArtistMedia);

    // Legacy flag kept for wiring into runSearchResolveBackfill; with strict DB-first
    // we only ingest when there's nothing to show.
    const forceArtistIngest = false;

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
      forceArtistIngest,
      ingestArtistName,
      sync,
      hasRenderableLocal,
      artistExistsInDb,
    });

    let artist_ingested = false;
    const artist_name = ingestArtistName;

    let ingest_started = false;

    // DB-first policy: ingest ONLY when we have nothing to show AND the artist doesn't already exist in DB.
    // (For artist queries, an existing artists row means "do not call YouTube" even if tracks/playlists are empty.)
    const needsBackfill = !hasRenderableLocal && !artistExistsInDb;

    if (needsBackfill && ingestArtistName) {
      console.info(RESOLVE_LOG_PREFIX, "INGEST_NEEDED", {
        q,
        mode,
        ingestArtistName,
        missingTracks,
        missingPlaylists,
        missingArtists,
        forceArtistIngest,
      });

      const ingestKey = normalizeArtistKey(ingestArtistName);
      const ingestMap = getIngestMap();
      const entry: IngestEntry =
        ingestMap.get(ingestKey) ?? { promise: null, startedAt: null, lastCompletedAt: null, lastFailedAt: null };

      if (entry.promise) {
        ingest_started = true;
        console.info(RESOLVE_LOG_PREFIX, "INGEST_INFLIGHT", {
          q,
          mode,
          ingestArtistName,
          ingestKey,
          ageMs: entry.startedAt ? Date.now() - entry.startedAt : null,
        });
      } else {
        // Cooldown avoids hammering YouTube on repeated resolve calls.
        // For strict DB-first, we only ever ingest on empty local results.
        const ttlMs = 30_000;
        const last = entry.lastCompletedAt ?? entry.lastFailedAt ?? 0;
        const ageMs = last ? Date.now() - last : null;

        if (ttlMs > 0 && last > 0 && ageMs !== null && ageMs < ttlMs) {
          console.info(RESOLVE_LOG_PREFIX, "INGEST_DEDUPED", {
            q,
            mode,
            ingestArtistName,
            ingestKey,
            ageMs,
            ttlMs,
          });
        } else {
          ingest_started = true;
          console.info(RESOLVE_LOG_PREFIX, "INGEST_START", { q, mode, ingestArtistName, ingestKey, sync });

          const run = async () => {
            await runSearchResolveBackfill({ q, mode, ingestArtistName, missingTracks, missingPlaylists, missingArtists, forceArtistIngest });
          };

          if (sync) {
            // Synchronous resolve: run ingest and then return refreshed local results.
            try {
              entry.startedAt = Date.now();
              entry.promise = run();
              ingestMap.set(ingestKey, entry);
              await entry.promise;
              entry.lastCompletedAt = Date.now();
              console.info(RESOLVE_LOG_PREFIX, "INGEST_DONE", { ingestArtistName, ingestKey });
            } catch (err: any) {
              entry.lastFailedAt = Date.now();
              console.error(RESOLVE_LOG_PREFIX, "INGEST_FAILED", {
                ingestArtistName,
                ingestKey,
                message: err?.message ? String(err.message) : "unknown",
              });
            } finally {
              entry.promise = null;
              entry.startedAt = null;
              ingestMap.set(ingestKey, entry);
            }

            // Refresh local results after ingest attempt.
            const refreshed = await fetchLocal();
            const artist = ingestArtistName ? await loadArtistMediaByName(ingestArtistName) : ingestArtistMedia;
            console.info(RESOLVE_LOG_PREFIX, "FINAL_COUNTS", {
              q,
              mode,
              tracks: refreshed.local.tracks.length,
              playlists: refreshed.local.playlists.length,
            });

            return res.json({
              q,
              tracks: refreshed.tracks,
              playlists_by_title: refreshed.playlists_by_title,
              playlists_by_artist: refreshed.playlists_by_artist,
              artist_channels: refreshed.artist_channels,
              local: refreshed.local,
              decision: "local_only",
              artist_ingested: false,
              ingest_started: true,
              artist_name: ingestArtistName,
              artist,
            });
          }

          // Async/background ingest (non-sync callers only).
          entry.startedAt = Date.now();
          entry.promise = (async () => {
            try {
              await run();
              entry.lastCompletedAt = Date.now();
              console.info(RESOLVE_LOG_PREFIX, "INGEST_DONE", { ingestArtistName, ingestKey });
            } catch (err: any) {
              entry.lastFailedAt = Date.now();
              console.error(RESOLVE_LOG_PREFIX, "INGEST_FAILED", {
                ingestArtistName,
                ingestKey,
                message: err?.message ? String(err.message) : "unknown",
              });
              throw err;
            } finally {
              entry.promise = null;
              entry.startedAt = null;
              ingestMap.set(ingestKey, entry);
            }
          })();

          ingestMap.set(ingestKey, entry);
        }
      }
    } else if (needsBackfill) {
      const key = `query:${q.toLowerCase()}`;
      const gate = shouldStartBackfill(key, BACKFILL_DEDUP_MS);
      if (gate.start) {
        ingest_started = true;

        if (sync) {
          await runSearchResolveBackfill({ q, mode, ingestArtistName, missingTracks, missingPlaylists, missingArtists, forceArtistIngest });
          const refreshed = await fetchLocal();
          const artist = ingestArtistName ? await loadArtistMediaByName(ingestArtistName) : ingestArtistMedia;
          console.info(RESOLVE_LOG_PREFIX, "FINAL_COUNTS", {
            q,
            mode,
            tracks: refreshed.local.tracks.length,
            playlists: refreshed.local.playlists.length,
          });
          return res.json({
            q,
            tracks: refreshed.tracks,
            playlists_by_title: refreshed.playlists_by_title,
            playlists_by_artist: refreshed.playlists_by_artist,
            artist_channels: refreshed.artist_channels,
            local: refreshed.local,
            decision: "local_only",
            artist_ingested: false,
            ingest_started: true,
            artist_name: ingestArtistName,
            artist,
          });
        }

        setImmediate(() => {
          console.info(RESOLVE_LOG_PREFIX, "BACKFILL_SCHEDULED", { q, mode, ttlMs: BACKFILL_DEDUP_MS });
          void runSearchResolveBackfill({ q, mode, ingestArtistName, missingTracks, missingPlaylists, missingArtists, forceArtistIngest });
        });
      } else {
        console.info(RESOLVE_LOG_PREFIX, "BACKFILL_DEDUPED", { q, mode, ageMs: gate.ageMs, ttlMs: BACKFILL_DEDUP_MS });
      }
    }

    // Return immediately with current local results; any backfill/ingest runs in the background.
    const after = before;
    // Artist media lookup is local DB-only and cheap; include it so the UI can show avatar instantly.
    const artist = ingestArtistMedia;

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
      ingest_started,
      artist_name,
      artist,
    });
  } catch (err: any) {
    console.warn("[SearchResolve] ERROR", { q, mode, message: err?.message ? String(err.message) : "unknown" });
    return res.status(500).json({ error: "Search resolve failed" });
  }
});

export default router;
