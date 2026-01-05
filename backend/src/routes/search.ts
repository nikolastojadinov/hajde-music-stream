import { Router } from 'express';
import { youtubeSearchMixed } from '../services/youtubeClient';

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
    const mixed = await youtubeSearchMixed(q);

    const suggestions: SearchSuggestion[] = [];

    for (const channel of mixed.channels) {
      suggestions.push({
        type: 'artist',
        id: channel.channelId,
        name: channel.title,
        imageUrl: channel.thumbUrl,
      });
    }

    for (const video of mixed.videos) {
      suggestions.push({
        type: 'track',
        id: video.videoId,
        name: video.title,
        imageUrl: video.thumbUrl,
        subtitle: video.channelTitle,
        artists: video.channelTitle ? [video.channelTitle] : undefined,
      });
    }

    for (const playlist of mixed.playlists) {
      suggestions.push({
        type: 'album',
        id: playlist.playlistId,
        name: playlist.title,
        imageUrl: playlist.thumbUrl,
        subtitle: playlist.channelTitle,
      });
    }

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
    const mixed = await youtubeSearchMixed(q);

    const tracks = mixed.videos.map<SearchTrack>((video) => ({
      id: video.videoId,
      title: video.title,
      artist: video.channelTitle || 'Unknown artist',
      youtubeId: video.videoId,
      imageUrl: video.thumbUrl,
    }));

    const artists = mixed.channels.map<SearchArtist>((channel) => ({
      id: channel.channelId,
      name: channel.title,
      imageUrl: channel.thumbUrl,
    }));

    const albums = mixed.playlists.map<SearchAlbum>((playlist) => ({
      id: playlist.playlistId,
      title: playlist.title,
      channelId: playlist.channelId || null,
      channelTitle: playlist.channelTitle || null,
      imageUrl: playlist.thumbUrl,
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
