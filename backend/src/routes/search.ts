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

export type SearchTrack = {
  id: string;
  title: string;
  artist: string;
  youtubeId: string;
  imageUrl?: string;
};

export type SearchArtist = {
  id: string;
  name: string;
  imageUrl?: string;
};

export type SearchAlbum = {
  id: string;
  title: string;
  channelId?: string | null;
  channelTitle?: string | null;
  imageUrl?: string;
};

export type SearchResultsResponse = {
  q: string;
  source: 'youtube_live';
  tracks: SearchTrack[];
  artists: SearchArtist[];
  albums: SearchAlbum[];
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
  return { q, source: 'youtube_live', tracks: [], artists: [], albums: [] };
}

function emptySuggestions(q: string): SearchSuggestResponse {
  return { q, source: 'youtube_live', suggestions: [] };
}

type Section = {
  kind?: string;
  items?: any[];
};

function pickSection(live: any, kind: string): any[] {
  const sections = Array.isArray(live?.sections) ? (live.sections as Section[]) : [];
  const section = sections.find((s) => typeof s?.kind === 'string' && s.kind === kind);
  return Array.isArray(section?.items) ? section!.items! : [];
}

function mapTrack(item: any): SearchTrack | null {
  const id = normalizeString(item?.id || item?.youtubeId);
  const youtubeId = normalizeString(item?.youtubeId || item?.id);
  if (!youtubeId) return null;

  const title = normalizeString(item?.title || item?.name) || 'Unknown';
  const artist = normalizeString(item?.artist || (Array.isArray(item?.artists) ? item.artists.join(', ') : '')) || 'Unknown artist';
  const imageUrl = normalizeString(item?.imageUrl) || undefined;
  return { id: id || youtubeId, title, artist, youtubeId, imageUrl };
}

function mapArtist(item: any): SearchArtist | null {
  const id = normalizeString(item?.id);
  const name = normalizeString(item?.name || item?.title);
  if (!id || !name) return null;
  const imageUrl = normalizeString(item?.imageUrl) || undefined;
  return { id, name, imageUrl };
}

function mapAlbum(item: any): SearchAlbum | null {
  const id = normalizeString(item?.id);
  const title = normalizeString(item?.title || item?.name);
  if (!id || !title) return null;
  const channelId = item?.channelId ?? null;
  const channelTitle = item?.channelTitle ?? item?.subtitle ?? null;
  const imageUrl = normalizeString(item?.imageUrl) || undefined;
  return { id, title, channelId, channelTitle, imageUrl };
}

function deriveTracks(live: any): SearchTrack[] {
  const fromSections = pickSection(live, 'songs')
    .map(mapTrack)
    .filter((t): t is SearchTrack => Boolean(t));
  if (fromSections.length > 0) return fromSections;

  const flat = Array.isArray(live?.tracks) ? live.tracks : [];
  return flat
    .map(mapTrack)
    .filter((t): t is SearchTrack => Boolean(t));
}

function deriveArtists(live: any): SearchArtist[] {
  const fromSections = pickSection(live, 'artists')
    .map(mapArtist)
    .filter((a): a is SearchArtist => Boolean(a));
  if (fromSections.length > 0) return fromSections;

  const flat = Array.isArray(live?.artists) ? live.artists : [];
  return flat
    .map(mapArtist)
    .filter((a): a is SearchArtist => Boolean(a));
}

function deriveAlbums(live: any): SearchAlbum[] {
  const fromSections = pickSection(live, 'albums')
    .map(mapAlbum)
    .filter((a): a is SearchAlbum => Boolean(a));
  if (fromSections.length > 0) return fromSections;

  const flat = Array.isArray(live?.albums) ? live.albums : [];
  return flat
    .map(mapAlbum)
    .filter((a): a is SearchAlbum => Boolean(a));
}

router.get('/suggest', async (req, res) => {
  const q = normalizeString(req.query.q);
  if (q.length < MIN_QUERY_CHARS) {
    return res.json(emptySuggestions(q));
  }

  try {
    const live = await musicSearch(q);

    const tracks = deriveTracks(live);
    const artists = deriveArtists(live);
    const albums = deriveAlbums(live);

    const suggestions: SearchSuggestion[] = [
      ...artists.map<SearchSuggestion>((a) => ({ type: 'artist', id: a.id, name: a.name, imageUrl: a.imageUrl })),
      ...tracks.map<SearchSuggestion>((t) => ({
        type: 'track',
        id: t.id,
        name: t.title,
        imageUrl: t.imageUrl,
        subtitle: t.artist,
        artists: t.artist ? [t.artist] : undefined,
      })),
      ...albums.map<SearchSuggestion>((a) => ({
        type: 'album',
        id: a.id,
        name: a.title,
        imageUrl: a.imageUrl,
        subtitle: a.channelTitle || undefined,
      })),
      ...((Array.isArray(live?.suggestions) ? live.suggestions : []) as any[]).map<SearchSuggestion>((s) => ({
        type: s.type,
        id: s.id,
        name: s.name,
        imageUrl: s.imageUrl,
        subtitle: s.subtitle,
      })),
    ];

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

    const tracks = deriveTracks(live);
    const artists = deriveArtists(live);
    const albums = deriveAlbums(live);

    res.set('Cache-Control', 'no-store');
    const payload: SearchResultsResponse = { q, source: 'youtube_live', tracks, artists, albums };
    return res.json(payload);
  } catch (err: any) {
    console.error('[search.results] failed', { message: err?.message || 'unknown' });
    return res.status(500).json({ error: 'search_failed' });
  }
});

export default router;
