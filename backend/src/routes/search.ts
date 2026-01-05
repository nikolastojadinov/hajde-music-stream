import { Router } from 'express';
import { musicSearch } from '../services/youtubeMusicClient';

const router = Router();

const MIN_QUERY_CHARS = 2;

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

router.get('/suggest', async (req, res) => {
  const q = normalizeString(req.query.q);
  if (q.length < MIN_QUERY_CHARS) {
    return res.json(emptySuggestions(q));
  }

  try {
    const live = await musicSearch(q);
    const suggestions: SearchSuggestion[] = Array.isArray(live?.suggestions)
      ? live.suggestions.map((s) => ({
          type: s.type,
          id: s.id,
          name: s.name,
          imageUrl: s.imageUrl,
          subtitle: s.subtitle,
          artists: s.artists,
        }))
      : [];

    res.set('Cache-Control', 'no-store');
    return res.json({ q, source: 'youtube_live', suggestions });
  } catch (err: any) {
    console.error('[search.suggest] failed', { message: err?.message || 'unknown' });
    return res.status(500).json({ error: 'suggest_failed' });
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
    console.error('[search.results] failed', { message: err?.message || 'unknown' });
    return res.status(500).json({ error: 'search_failed' });
  }
});

export default router;
