import { Router } from 'express';
import { musicSearch, musicSearchRaw } from '../services/youtubeMusicClient';

const router = Router();

const MIN_QUERY_CHARS = 2;
const MAX_SUGGESTIONS = 8;

export type SearchSuggestion = {
  type: 'artist' | 'track' | 'album';
  id: string;
  name: string;
  imageUrl?: string;
  subtitle?: string;
  artists?: string[];
};

export type SearchResultsResponse = {
  q: string;
  source: 'youtube_live';
  sections: Array<{ kind: string; title?: string | null; items: any[]; continuation?: unknown }>;
  refinements?: string[];
  tracks?: any[];
  artists?: any[];
  albums?: any[];
  playlists?: any[];
};

export type SearchSuggestResponse = {
  q: string;
  source: 'youtube_live';
  suggestions: SearchSuggestion[];
};

function normalizeString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function emptyResults(q: string): SearchResultsResponse {
  return { q, source: 'youtube_live', sections: [], refinements: [], tracks: [], artists: [], albums: [], playlists: [] };
}

function emptySuggestions(q: string): SearchSuggestResponse {
  return { q, source: 'youtube_live', suggestions: [] };
}

function toSuggestionId(entry: any, name: string, index: number): string {
  const candidates = [entry?.browseId, entry?.videoId, entry?.id].map(normalizeString).filter(Boolean);
  return candidates[0] || `${name}-${index}`;
}

function toArtists(entry: any): string[] | undefined {
  const list = Array.isArray(entry?.artists) ? entry.artists : [];
  const names = list.map(normalizeString).filter(Boolean);
  if (names.length > 0) return names;
  const single = normalizeString(entry?.artist);
  return single ? [single] : undefined;
}

function toImage(entry: any): string | undefined {
  const image = normalizeString(entry?.imageUrl) || normalizeString(entry?.thumbnailUrl) || normalizeString(entry?.thumbnail);
  return image || undefined;
}

function toSubtitle(entry: any): string | undefined {
  const subtitle = normalizeString(entry?.subtitle) || normalizeString(entry?.description) || normalizeString(entry?.album);
  return subtitle || undefined;
}

function makeSuggestion(entry: any, type: SearchSuggestion['type'], index: number): SearchSuggestion | null {
  const name = normalizeString(entry?.name) || normalizeString(entry?.title) || normalizeString(entry?.text);
  if (!name) return null;
  const id = toSuggestionId(entry, name, index);
  return {
    type,
    id,
    name,
    imageUrl: toImage(entry),
    subtitle: toSubtitle(entry),
    artists: type === 'track' ? toArtists(entry) : undefined,
  };
}

function buildSuggestions(live: any): SearchSuggestion[] {
  const result: SearchSuggestion[] = [];
  const seen = new Set<string>();
  let cursor = 0;

  const addAll = (entries: any[], type: SearchSuggestion['type']) => {
    for (const entry of entries) {
      if (result.length >= MAX_SUGGESTIONS) return;
      const suggestion = makeSuggestion(entry, type, cursor++);
      if (!suggestion) continue;
      const key = suggestion.name.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      result.push(suggestion);
    }
  };

  addAll(Array.isArray(live?.artists) ? live.artists : [], 'artist');
  addAll(Array.isArray(live?.tracks) ? live.tracks : [], 'track');
  addAll(Array.isArray(live?.albums) ? live.albums : [], 'album');

  return result;
}

router.get('/suggest', async (req, res) => {
  const q = normalizeString(req.query.q);
  if (q.length < MIN_QUERY_CHARS) {
    return res.json(emptySuggestions(q));
  }

  try {
    const live = await musicSearch(q);
    const suggestions = buildSuggestions(live);
    res.set('Cache-Control', 'no-store');
    return res.json({ q, source: 'youtube_live', suggestions });
  } catch (err: any) {
    return res.status(500).json({ error: 'suggest_failed' });
  }
});

router.get('/raw', async (req, res) => {
  const q = normalizeString(req.query.q);
  if (q.length < MIN_QUERY_CHARS) {
    return res.json({ q, rawInnertubeResponse: null });
  }

  try {
    const rawInnertubeResponse = await musicSearchRaw(q);
    res.set('Cache-Control', 'no-store');
    return res.json({ q, rawInnertubeResponse });
  } catch (err: any) {
    return res.status(500).json({ error: 'raw_search_failed' });
  }
});

router.get('/results', async (req, res) => {
  const q = normalizeString(req.query.q);
  if (q.length < MIN_QUERY_CHARS) {
    return res.json(emptyResults(q));
  }

  try {
    const live = await musicSearch(q);
    res.set('Cache-Control', 'no-store');
    const payload: SearchResultsResponse = {
      q,
      source: 'youtube_live',
      sections: Array.isArray(live?.sections) ? live.sections : [],
      refinements: Array.isArray(live?.refinements) ? live.refinements : [],
      tracks: Array.isArray(live?.tracks) ? live.tracks : [],
      artists: Array.isArray(live?.artists) ? live.artists : [],
      albums: Array.isArray(live?.albums) ? live.albums : [],
      playlists: Array.isArray(live?.playlists) ? live.playlists : [],
    };
    return res.json(payload);
  } catch (err: any) {
    return res.status(500).json({ error: 'search_failed' });
  }
});

export default router;
