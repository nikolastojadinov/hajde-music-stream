import { Router } from "express";

import supabase, {
  searchArtistChannelsForQuery,
  searchPlaylistsDualForQuery,
  searchTracksForQuery,
  type SearchArtistChannelRow,
  type SearchPlaylistRow,
  type SearchTrackRow,
} from "../services/supabaseClient";
import { spotifySearch, SpotifyRateLimitedError } from "../services/spotifyClient";
import { buildSuggestCacheKey, cacheSuggest, getCachedSuggest } from "../services/suggestCache";
import { youtubeSearchMixed, YouTubeQuotaExceededError } from "../services/youtubeClient";
import { ingestArtistFromYouTubeByChannelId } from "../services/youtubeIngestService";
import { MAX_SUGGESTIONS, type SuggestEnvelope, type SuggestionItem } from "../types/suggest";
import { isOlakPlaylistId } from "../utils/olak";

const router = Router();

const MIN_QUERY_CHARS = 2;
const TRACK_LIMIT = 8;
const PLAYLIST_LIMIT = 8;
const ARTIST_LIMIT = 3;
const LOG_PREFIX = "[search]";

// Types

type ResolveMode = "track" | "artist" | "album" | "generic";

type ResolveRequestBody = {
  q?: unknown;
  mode?: unknown;
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

type LocalArtistChannel = {
  channelId: string;
  title: string;
  thumbnailUrl: string | null;
};

type LocalSearchResult = {
  tracks: LocalTrack[];
  playlists_by_title: LocalPlaylist[];
  playlists_by_artist: LocalPlaylist[];
  mergedPlaylists: LocalPlaylist[];
  artist_channels: LocalArtistChannel[];
};

type YouTubeMixedChannel = { channelId: string; title: string; thumbUrl?: string };
type YouTubeMixedVideo = { videoId: string; title: string; channelId: string; channelTitle: string; thumbUrl?: string };
type YouTubeMixedPlaylist = { playlistId: string; title: string; channelId: string; channelTitle: string; thumbUrl?: string };

// Helpers

function normalizeQuery(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeMode(value: unknown): ResolveMode {
  const v = typeof value === "string" ? value : "";
  if (v === "track" || v === "artist" || v === "album" || v === "generic") return v;
  return "generic";
}

function mapTrackRow(row: SearchTrackRow): LocalTrack {
  const externalId = typeof row.external_id === "string" && row.external_id ? row.external_id : null;
  const youtubeId = typeof row.youtube_id === "string" && row.youtube_id ? row.youtube_id : null;
  return {
    id: String(row.id),
    title: typeof row.title === "string" ? row.title : "",
    artist: typeof row.artist === "string" ? row.artist : "",
    externalId: externalId ?? youtubeId,
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

function mapArtistChannelRow(row: SearchArtistChannelRow): LocalArtistChannel | null {
  const title = typeof row.name === "string" ? row.name.trim() : "";
  const channelId = typeof row.youtube_channel_id === "string" ? row.youtube_channel_id.trim() : "";
  if (!title || !channelId) return null;
  return { channelId, title, thumbnailUrl: null };
}

function mergePlaylists(byTitle: LocalPlaylist[], byArtist: LocalPlaylist[]): LocalPlaylist[] {
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

function emptyResult(): LocalSearchResult {
  return {
    tracks: [],
    playlists_by_title: [],
    playlists_by_artist: [],
    mergedPlaylists: [],
    artist_channels: [],
  };
}

function hasAnyResults(result: LocalSearchResult, mode: ResolveMode): boolean {
  if (mode === "track") return result.tracks.length > 0;
  return result.tracks.length > 0 || result.mergedPlaylists.length > 0 || result.artist_channels.length > 0;
}

// Supabase search

async function runSupabaseSearch(
  q: string,
  options?: { trackLimit?: number; playlistLimit?: number; artistLimit?: number; prioritizeArtist?: boolean }
): Promise<LocalSearchResult> {
  const query = normalizeQuery(q);
  if (!supabase || query.length < MIN_QUERY_CHARS) return emptyResult();

  const trackLimit = options?.trackLimit ?? TRACK_LIMIT;
  const playlistLimit = options?.playlistLimit ?? PLAYLIST_LIMIT;
  const artistLimit = options?.artistLimit ?? ARTIST_LIMIT;
  const prioritizeArtist = options?.prioritizeArtist ?? false;

  const [trackRows, playlistsDual, artistRows] = await Promise.all([
    searchTracksForQuery(query, { limit: trackLimit, prioritizeArtistMatch: prioritizeArtist }),
    searchPlaylistsDualForQuery(query, { limit: playlistLimit, prioritizeArtistMatch: prioritizeArtist }),
    searchArtistChannelsForQuery(query),
  ]);

  const playlistsByTitle = playlistsDual.playlists_by_title
    .map(mapPlaylistRow)
    .filter((p) => !isOlakPlaylistId(p.externalId))
    .slice(0, playlistLimit);

  const playlistsByArtist = playlistsDual.playlists_by_artist
    .map(mapPlaylistRow)
    .filter((p) => !isOlakPlaylistId(p.externalId))
    .slice(0, playlistLimit);

  const merged = mergePlaylists(playlistsByTitle, playlistsByArtist).slice(0, playlistLimit);

  const artistChannels = artistRows
    .map(mapArtistChannelRow)
    .filter((x): x is LocalArtistChannel => Boolean(x))
    .slice(0, artistLimit);

  return {
    tracks: trackRows.map(mapTrackRow).slice(0, trackLimit),
    playlists_by_title: playlistsByTitle,
    playlists_by_artist: playlistsByArtist,
    mergedPlaylists: merged,
    artist_channels: artistChannels,
  };
}

// YouTube helpers

function scoreChannelTitle(title: string, queryLower: string): number {
  const lower = title.toLowerCase();
  const cleaned = lower.replace(/- topic$/i, "").trim();
  let score = 0;

  if (cleaned === queryLower) score += 6;
  if (lower.includes(queryLower)) score += 4;
  if (/official/.test(lower)) score += 2;
  if (/- topic$/i.test(title)) score += 1;

  return score;
}

function pickBestChannelFromMixed(mixed: Awaited<ReturnType<typeof youtubeSearchMixed>>, q: string): YouTubeMixedChannel | null {
  const queryLower = normalizeQuery(q).toLowerCase();
  const candidates: Array<{ channelId: string; title: string; score: number }> = [];

  for (const channel of mixed.channels) {
    const score = scoreChannelTitle(channel.title, queryLower);
    if (score <= 0) continue;
    candidates.push({ channelId: channel.channelId, title: channel.title, score });
  }

  if (candidates.length === 0) {
    for (const video of mixed.videos) {
      const score = scoreChannelTitle(video.channelTitle || video.title, queryLower) - 1;
      if (score <= 0) continue;
      candidates.push({ channelId: video.channelId, title: video.channelTitle || video.title, score });
    }
  }

  if (candidates.length === 0) return null;
  candidates.sort((a, b) => b.score - a.score);
  return candidates[0];
}

async function persistYouTubeMixedResults(opts: {
  q: string;
  channels: YouTubeMixedChannel[];
  videos: YouTubeMixedVideo[];
  playlists: YouTubeMixedPlaylist[];
}): Promise<void> {
  if (!supabase) return;

  // Cache channels best-effort (artist mapping table not modified here to avoid conflicts).
  if (opts.channels.length > 0) {
    const rows = opts.channels
      .map((ch) => ({
        youtube_channel_id: normalizeQuery(ch.channelId),
        name: normalizeQuery(ch.title) || null,
      }))
      .filter((r) => r.youtube_channel_id && r.name);

    if (rows.length > 0) {
      try {
        await supabase.from("youtube_channels").upsert(rows as any, { onConflict: "youtube_channel_id" });
      } catch {
        // best effort
      }
    }
  }

  if (opts.videos.length > 0) {
    const trackRows = opts.videos
      .map((v) => {
        const external_id = normalizeQuery(v.videoId);
        const title = normalizeQuery(v.title);
        if (!external_id || !title) return null;
        const channelTitle = normalizeQuery(v.channelTitle);
        const channelId = normalizeQuery(v.channelId);
        return {
          source: "youtube" as const,
          external_id,
          youtube_id: external_id,
          title,
          artist: channelTitle || null,
          cover_url: v.thumbUrl ?? null,
          artist_channel_id: channelId || null,
          duration: null,
        };
      })
      .filter((x): x is NonNullable<typeof x> => Boolean(x));

    if (trackRows.length > 0) {
      try {
        await supabase.from("tracks").upsert(trackRows as any, { onConflict: "external_id" });
      } catch {
        // best effort
      }
    }
  }

  if (opts.playlists.length > 0) {
    const playlistRows = opts.playlists
      .map((p) => {
        const external_id = normalizeQuery(p.playlistId);
        const title = normalizeQuery(p.title);
        if (!external_id || !title) return null;
        if (isOlakPlaylistId(external_id)) return null;
        const channel_id = normalizeQuery(p.channelId);
        const channel_title = normalizeQuery(p.channelTitle);
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
        await supabase.from("playlists").upsert(playlistRows as any, { onConflict: "external_id" });
      } catch {
        // best effort
      }
    }
  }
}

// Response builder

function buildSearchResponse(q: string, result: LocalSearchResult, artistIngested: boolean, ingestStarted: boolean, artistName: string | null) {
  return {
    q,
    tracks: result.tracks,
    playlists_by_title: result.playlists_by_title,
    playlists_by_artist: result.playlists_by_artist,
    artist_channels: { local: result.artist_channels, youtube: [], decision: "local_only" },
    local: { tracks: result.tracks, playlists: result.mergedPlaylists },
    decision: "local_only",
    artist_ingested: artistIngested,
    ingest_started: ingestStarted,
    artist_name: artistName,
    artist: null,
  };
}

// Suggest endpoint

async function buildLocalSuggestions(q: string): Promise<SuggestionItem[]> {
  const local = await runSupabaseSearch(q, { trackLimit: 12, playlistLimit: 12, artistLimit: 5, prioritizeArtist: true });
  const suggestions: SuggestionItem[] = [];

  for (const track of local.tracks) {
    const playableId = track.externalId ?? track.id;
    suggestions.push({
      type: "track",
      id: playableId,
      name: track.title,
      imageUrl: track.coverUrl || undefined,
      subtitle: track.artist || undefined,
      artists: track.artist ? [track.artist] : undefined,
    });
  }

  for (const playlist of local.mergedPlaylists) {
    suggestions.push({
      type: "playlist",
      id: playlist.id,
      name: playlist.title,
      imageUrl: playlist.coverUrl || undefined,
    });
  }

  for (const artist of local.artist_channels) {
    suggestions.push({ type: "artist", id: artist.channelId, name: artist.title });
  }

  const seen = new Set<string>();
  return suggestions.filter((s) => {
    const key = `${s.type}:${s.id}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

router.get("/suggest", async (req, res) => {
  const q = normalizeQuery(req.query.q);
  const cacheKey = buildSuggestCacheKey(q, "spotify");

  if (cacheKey.length >= MIN_QUERY_CHARS) {
    const cached = await getCachedSuggest(cacheKey);
    if (cached) {
      return res.json(cached);
    }
  }

  try {
    const result = await spotifySearch(q);
    const suggestions: SuggestionItem[] = [];

    for (const a of result.artists) {
      suggestions.push({ type: "artist", id: a.id, name: a.name, imageUrl: a.imageUrl });
    }

    for (const t of result.tracks) {
      const artists = Array.isArray((t as any).artistNames) ? ((t as any).artistNames as string[]) : [];
      const subtitle = artists.length > 0 ? artists.join(", ") : (t as any).artistName || undefined;
      suggestions.push({
        type: "track",
        id: t.id,
        name: t.name,
        imageUrl: t.imageUrl,
        subtitle,
        artists: artists.length > 0 ? artists : undefined,
      });
    }

    for (const p of result.playlists) {
      suggestions.push({ type: "playlist", id: p.id, name: p.name, imageUrl: p.imageUrl, subtitle: p.ownerName || undefined });
    }

    for (const a of result.albums) {
      suggestions.push({ type: "album", id: a.id, name: a.name, imageUrl: a.imageUrl, subtitle: a.artistName || undefined });
    }

    const payload: SuggestEnvelope = { q, source: "spotify_suggest", suggestions: suggestions.slice(0, MAX_SUGGESTIONS) };
    if (cacheKey.length >= MIN_QUERY_CHARS) await cacheSuggest(cacheKey, payload);
    return res.json(payload);
  } catch (err: any) {
    const rateLimited = err instanceof SpotifyRateLimitedError;
    console.warn(`${LOG_PREFIX} suggest_primary_failed`, {
      q,
      rateLimited,
      message: err?.message ? String(err.message) : "unknown",
    });

    let suggestions: SuggestionItem[] = [];
    try {
      suggestions = await buildLocalSuggestions(q);
    } catch (fallbackErr: any) {
      console.warn(`${LOG_PREFIX} suggest_fallback_failed`, {
        q,
        message: fallbackErr?.message ? String(fallbackErr.message) : "unknown",
      });
      suggestions = [];
    }

    const payload: SuggestEnvelope = { q, source: "local_fallback", suggestions: suggestions.slice(0, MAX_SUGGESTIONS) };
    if (cacheKey.length >= MIN_QUERY_CHARS) await cacheSuggest(cacheKey, payload);

    return res.json(payload);
  }
});

// Resolve endpoint

router.post("/resolve", async (req, res) => {
  const body = (req.body || {}) as ResolveRequestBody;
  const q = normalizeQuery(body.q);
  const mode = normalizeMode(body.mode);

  if (!supabase) {
    return res.status(503).json({ error: "Search unavailable" });
  }

  if (q.length < MIN_QUERY_CHARS) {
    return res.json(buildSearchResponse(q, emptyResult(), false, false, null));
  }

  try {
    const initial = await runSupabaseSearch(q, { prioritizeArtist: mode === "artist" });

    if (hasAnyResults(initial, mode)) {
      console.info(`${LOG_PREFIX} local_hit`, {
        q,
        mode,
        tracks: initial.tracks.length,
        playlists: initial.mergedPlaylists.length,
        artists: initial.artist_channels.length,
      });
      return res.json(buildSearchResponse(q, initial, false, false, mode === "artist" ? q : null));
    }

    // Nothing local to render -> YouTube fallback/backfill path.
    let artist_ingested = false;
    let ingest_started = false;
    const ingestAllowed = mode === "artist";

    try {
      const mixed = await youtubeSearchMixed(q);
      const candidate = pickBestChannelFromMixed(mixed, q);

      if (!candidate) {
        console.info(`${LOG_PREFIX} youtube_ingest_skipped`, { q, reason: "no_candidate" });
        await persistYouTubeMixedResults({ q, channels: mixed.channels, videos: mixed.videos, playlists: mixed.playlists });
      } else {
        console.info(`${LOG_PREFIX} youtube_ingest_triggered`, { q, channelId: candidate.channelId, ingestAllowed });
        ingest_started = true;

        if (ingestAllowed) {
          const ingestRes = await ingestArtistFromYouTubeByChannelId({ youtube_channel_id: candidate.channelId, artistName: q });
          artist_ingested = Boolean(ingestRes);
        } else {
          await persistYouTubeMixedResults({ q, channels: mixed.channels, videos: mixed.videos, playlists: mixed.playlists });
        }
      }
    } catch (err: any) {
      const quota = err instanceof YouTubeQuotaExceededError;
      console.warn(`${LOG_PREFIX} youtube_ingest_skipped`, {
        q,
        reason: quota ? "quota_exceeded" : "error",
        message: err?.message ? String(err.message) : "unknown",
      });
    }

    const refreshed = await runSupabaseSearch(q, { prioritizeArtist: mode === "artist" });

    console.info(`${LOG_PREFIX} requery_after_ingest`, {
      q,
      mode,
      tracks: refreshed.tracks.length,
      playlists: refreshed.mergedPlaylists.length,
      artists: refreshed.artist_channels.length,
      artist_ingested,
      ingest_started,
    });

    return res.json(buildSearchResponse(q, refreshed, artist_ingested, ingest_started, mode === "artist" ? q : null));
  } catch (err: any) {
    console.error(`${LOG_PREFIX} resolve_error`, { q, message: err?.message ? String(err.message) : "unknown" });
    return res.status(500).json({ error: "Search resolve failed" });
  }
});

export default router;
