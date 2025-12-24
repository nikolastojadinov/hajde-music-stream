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
import { ingestArtistFromYouTubeByChannelId } from "../services/youtubeIngestService";
import { MAX_SUGGESTIONS, type SuggestEnvelope, type SuggestionItem } from "../types/suggest";
import { isOlakPlaylistId } from "../utils/olak";
import { youtubeSearchMixed, YouTubeQuotaExceededError } from "../services/youtubeClient";

const router = Router();

const MIN_QUERY_CHARS = 2;
const TRACK_LIMIT = 8;
const PLAYLIST_LIMIT = 8;
const ARTIST_LIMIT = 3;
const LOG_PREFIX = "[search]";

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

type ChannelCandidate = {
  channelId: string;
  title: string;
  score: number;
};

function normalizeQuery(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
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

function hasAnyResults(result: LocalSearchResult): boolean {
  return (
    result.tracks.length > 0 ||
    result.mergedPlaylists.length > 0 ||
    result.artist_channels.length > 0
  );
}

async function runSupabaseSearch(
  q: string,
  options?: { trackLimit?: number; playlistLimit?: number; artistLimit?: number; prioritizeArtist?: boolean },
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

function pickBestChannelFromMixed(mixed: Awaited<ReturnType<typeof youtubeSearchMixed>>, q: string): ChannelCandidate | null {
  const queryLower = normalizeQuery(q).toLowerCase();
  const candidates: ChannelCandidate[] = [];

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

async function tryYoutubeIngest(q: string): Promise<{ ingested: boolean; channelId: string | null }> {
  const query = normalizeQuery(q);
  if (query.length < MIN_QUERY_CHARS) return { ingested: false, channelId: null };

  try {
    const mixed = await youtubeSearchMixed(query);
    const candidate = pickBestChannelFromMixed(mixed, query);

    if (!candidate) {
      console.info(`${LOG_PREFIX} youtube_ingest_skipped`, { q: query, reason: "no_candidate" });
      return { ingested: false, channelId: null };
    }

    console.info(`${LOG_PREFIX} youtube_ingest_triggered`, { q: query, channelId: candidate.channelId });
    const ingestResult = await ingestArtistFromYouTubeByChannelId({ youtube_channel_id: candidate.channelId, artistName: query });
    return { ingested: Boolean(ingestResult), channelId: candidate.channelId };
  } catch (err: any) {
    const quota = err instanceof YouTubeQuotaExceededError;
    console.warn(`${LOG_PREFIX} youtube_ingest_skipped`, {
      q: query,
      reason: quota ? "quota_exceeded" : "error",
      message: err?.message ? String(err.message) : "unknown",
    });
    return { ingested: false, channelId: null };
  }
}

function buildSearchResponse(q: string, result: LocalSearchResult, artistIngested: boolean, artistName: string | null) {
  return {
    q,
    tracks: result.tracks,
    playlists_by_title: result.playlists_by_title,
    playlists_by_artist: result.playlists_by_artist,
    artist_channels: { local: result.artist_channels, youtube: [], decision: "local_only" },
    local: { tracks: result.tracks, playlists: result.mergedPlaylists },
    decision: "local_only",
    artist_ingested: artistIngested,
    ingest_started: artistIngested,
    artist_name: artistName,
    artist: null,
  };
}

async function buildLocalSuggestions(q: string): Promise<SuggestionItem[]> {
  const local = await runSupabaseSearch(q, { trackLimit: 12, playlistLimit: 12, artistLimit: 5, prioritizeArtist: true });
  const suggestions: SuggestionItem[] = [];

  for (const track of local.tracks) {
    suggestions.push({
      type: "track",
      id: track.id,
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

router.post("/resolve", async (req, res) => {
  const body = (req.body || {}) as { q?: unknown };
  const q = normalizeQuery(body.q);

  if (!supabase) {
    return res.status(503).json({ error: "Search unavailable" });
  }

  if (q.length < MIN_QUERY_CHARS) {
    return res.json(buildSearchResponse(q, emptyResult(), false, null));
  }

  try {
    const initial = await runSupabaseSearch(q);

    if (hasAnyResults(initial)) {
      console.info(`${LOG_PREFIX} local_hit`, {
        q,
        tracks: initial.tracks.length,
        playlists: initial.mergedPlaylists.length,
        artists: initial.artist_channels.length,
      });
      return res.json(buildSearchResponse(q, initial, false, q));
    }

    const { ingested } = await tryYoutubeIngest(q);
    const refreshed = await runSupabaseSearch(q);

    console.info(`${LOG_PREFIX} requery_after_ingest`, {
      q,
      tracks: refreshed.tracks.length,
      playlists: refreshed.mergedPlaylists.length,
      artists: refreshed.artist_channels.length,
      ingested,
    });

    return res.json(buildSearchResponse(q, refreshed, ingested, q));
  } catch (err: any) {
    console.error(`${LOG_PREFIX} resolve_error`, { q, message: err?.message ? String(err.message) : "unknown" });
    return res.status(500).json({ error: "Search resolve failed" });
  }
});

export default router;
