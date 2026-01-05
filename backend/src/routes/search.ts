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

router.get('/suggest', async (req, res) => {
  const q = normalizeString(req.query.q);
  if (q.length < MIN_QUERY_CHARS) {
    return res.json(emptySuggestions(q));
  }

  try {
    const live = await musicSearch(q);

    const suggestions: SearchSuggestion[] = [
      ...live.artists.map<SearchSuggestion>((a) => ({ type: 'artist', id: a.id, name: a.name, imageUrl: a.imageUrl })),
      ...live.tracks.map<SearchSuggestion>((t) => ({
        type: 'track',
        id: t.id,
        name: t.title,
        imageUrl: t.imageUrl,
        subtitle: t.artist,
        artists: t.artist ? [t.artist] : undefined,
      })),
      ...live.albums.map<SearchSuggestion>((a) => ({
        type: 'album',
        id: a.id,
        name: a.title,
        imageUrl: a.imageUrl,
        subtitle: a.channelTitle || undefined,
      })),
      ...live.suggestions.map<SearchSuggestion>((s) => ({
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

    const tracks = live.tracks.map<SearchTrack>((video) => ({
      id: video.id,
      title: video.title,
      artist: video.artist || 'Unknown artist',
      youtubeId: video.youtubeId,
      imageUrl: video.imageUrl,
    }));

    const artists = live.artists.map<SearchArtist>((channel) => ({
      id: channel.id,
      name: channel.name,
      imageUrl: channel.imageUrl,
    }));

    const albums = live.albums.map<SearchAlbum>((playlist) => ({
      id: playlist.id,
      title: playlist.title,
      channelId: playlist.channelId || null,
      channelTitle: playlist.channelTitle || null,
      imageUrl: playlist.imageUrl,
    }));

    res.set('Cache-Control', 'no-store');
    const payload: SearchResultsResponse = { q, source: 'youtube_live', tracks, artists, albums };
    return res.json(payload);
  } catch (err: any) {
    console.error('[search.results] failed', { message: err?.message || 'unknown' });
    return res.status(500).json({ error: 'search_failed' });
  }
});

export default router;
