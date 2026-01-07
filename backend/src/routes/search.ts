import { Router } from 'express';
import { musicSearch, type MusicSearchAlbum, type MusicSearchArtist, type MusicSearchPlaylist, type MusicSearchResults, type MusicSearchTrack } from '../services/youtubeMusicClient';

const router = Router();

const MIN_QUERY_CHARS = 2;
const MAX_SUGGESTIONS = 8;

type SuggestionType = 'artist' | 'track' | 'album' | 'playlist';

export type SearchSuggestItem = {
  type: SuggestionType;
  id: string;
  name: string;
  imageUrl?: string;
  subtitle?: string;
};

export type SearchSuggestResponse = {
  q: string;
  source: 'youtube_live';
  suggestions: SearchSuggestItem[];
};

export type SearchResultItem = {
  id: string;
  title: string;
  imageUrl?: string;
  subtitle?: string;
  endpointType: 'watch' | 'browse';
  endpointPayload: string;
};

export type SearchResultsResponse = {
  q: string;
  source: 'youtube_live';
  sections: Array<{
    kind: 'songs' | 'artists' | 'albums' | 'playlists';
    title: string | null;
    items: SearchResultItem[];
  }>;
};

function normalizeString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function isVideoId(value: string | undefined): value is string {
  return typeof value === 'string' && /^[A-Za-z0-9_-]{11}$/.test(value.trim());
}

function isNonEmpty(value: string | undefined | null): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function buildTrackSuggestion(track: MusicSearchTrack): SearchSuggestItem | null {
  if (!isVideoId(track.youtubeId) || !isNonEmpty(track.title)) return null;
  return {
    type: 'track',
    id: track.youtubeId,
    name: track.title.trim(),
    imageUrl: isNonEmpty(track.imageUrl) ? track.imageUrl : undefined,
    subtitle: isNonEmpty(track.artist) ? track.artist : undefined,
  };
}

function buildArtistSuggestion(artist: MusicSearchArtist): SearchSuggestItem | null {
  if (!isNonEmpty(artist.id) || !isNonEmpty(artist.name)) return null;
  return {
    type: 'artist',
    id: artist.id.trim(),
    name: artist.name.trim(),
    imageUrl: isNonEmpty(artist.imageUrl) ? artist.imageUrl : undefined,
    subtitle: undefined,
  };
}

function buildAlbumSuggestion(album: MusicSearchAlbum): SearchSuggestItem | null {
  if (!isNonEmpty(album.id) || !isNonEmpty(album.title)) return null;
  return {
    type: 'album',
    id: album.id.trim(),
    name: album.title.trim(),
    imageUrl: isNonEmpty(album.imageUrl) ? album.imageUrl : undefined,
    subtitle: isNonEmpty(album.channelTitle) ? album.channelTitle : undefined,
  };
}

function buildPlaylistSuggestion(playlist: MusicSearchPlaylist): SearchSuggestItem | null {
  if (!isNonEmpty(playlist.id) || !isNonEmpty(playlist.title)) return null;
  return {
    type: 'playlist',
    id: playlist.id.trim(),
    name: playlist.title.trim(),
    imageUrl: isNonEmpty(playlist.imageUrl) ? playlist.imageUrl : undefined,
    subtitle: isNonEmpty(playlist.channelTitle) ? playlist.channelTitle : undefined,
  };
}

function dedupePush<T extends { id: string }>(list: T[], seen: Set<string>, item: T): void {
  const key = item.id.trim();
  if (!key || seen.has(key)) return;
  seen.add(key);
  list.push(item);
}

function buildSuggestions(live: MusicSearchResults): SearchSuggestItem[] {
  const suggestions: SearchSuggestItem[] = [];
  const seen = new Set<string>();

  const pushItem = (candidate: SearchSuggestItem | null) => {
    if (!candidate) return;
    if (suggestions.length >= MAX_SUGGESTIONS) return;
    dedupePush(suggestions, seen, candidate);
  };

  for (const track of live.tracks || []) {
    if (suggestions.length >= MAX_SUGGESTIONS) break;
    pushItem(buildTrackSuggestion(track));
  }

  for (const artist of live.artists || []) {
    if (suggestions.length >= MAX_SUGGESTIONS) break;
    pushItem(buildArtistSuggestion(artist));
  }

  for (const album of live.albums || []) {
    if (suggestions.length >= MAX_SUGGESTIONS) break;
    pushItem(buildAlbumSuggestion(album));
  }

  for (const playlist of live.playlists || []) {
    if (suggestions.length >= MAX_SUGGESTIONS) break;
    pushItem(buildPlaylistSuggestion(playlist));
  }

  return suggestions.slice(0, MAX_SUGGESTIONS);
}

function mapTracks(tracks: MusicSearchTrack[]): SearchResultItem[] {
  return tracks
    .filter((t) => isVideoId(t.youtubeId) && isNonEmpty(t.title))
    .map((t) => ({
      id: t.youtubeId,
      title: t.title.trim(),
      imageUrl: isNonEmpty(t.imageUrl) ? t.imageUrl : undefined,
      subtitle: isNonEmpty(t.artist) ? t.artist : undefined,
      endpointType: 'watch' as const,
      endpointPayload: t.youtubeId,
    }));
}

function mapArtists(artists: MusicSearchArtist[]): SearchResultItem[] {
  return artists
    .filter((a) => isNonEmpty(a.id) && isNonEmpty(a.name))
    .map((a) => ({
      id: a.id.trim(),
      title: a.name.trim(),
      imageUrl: isNonEmpty(a.imageUrl) ? a.imageUrl : undefined,
      subtitle: undefined,
      endpointType: 'browse' as const,
      endpointPayload: a.id.trim(),
    }));
}

function mapAlbums(albums: MusicSearchAlbum[]): SearchResultItem[] {
  return albums
    .filter((a) => isNonEmpty(a.id) && isNonEmpty(a.title))
    .map((a) => ({
      id: a.id.trim(),
      title: a.title.trim(),
      imageUrl: isNonEmpty(a.imageUrl) ? a.imageUrl : undefined,
      subtitle: isNonEmpty(a.channelTitle) ? a.channelTitle : undefined,
      endpointType: 'browse' as const,
      endpointPayload: a.id.trim(),
    }));
}

function mapPlaylists(playlists: MusicSearchPlaylist[]): SearchResultItem[] {
  return playlists
    .filter((p) => isNonEmpty(p.id) && isNonEmpty(p.title))
    .map((p) => ({
      id: p.id.trim(),
      title: p.title.trim(),
      imageUrl: isNonEmpty(p.imageUrl) ? p.imageUrl : undefined,
      subtitle: isNonEmpty(p.channelTitle) ? p.channelTitle : undefined,
      endpointType: 'browse' as const,
      endpointPayload: p.id.trim(),
    }));
}

function buildSections(live: MusicSearchResults): SearchResultsResponse['sections'] {
  const sections: SearchResultsResponse['sections'] = [];

  const songs = mapTracks(live.tracks || []);
  if (songs.length > 0) {
    sections.push({ kind: 'songs', title: 'Songs', items: songs });
  }

  const artists = mapArtists(live.artists || []);
  if (artists.length > 0) {
    sections.push({ kind: 'artists', title: 'Artists', items: artists });
  }

  const albums = mapAlbums(live.albums || []);
  if (albums.length > 0) {
    sections.push({ kind: 'albums', title: 'Albums', items: albums });
  }

  const playlists = mapPlaylists(live.playlists || []);
  if (playlists.length > 0) {
    sections.push({ kind: 'playlists', title: 'Playlists', items: playlists });
  }

  return sections;
}

router.get('/suggest', async (req, res) => {
  const q = normalizeString(req.query.q);
  if (q.length < MIN_QUERY_CHARS) {
    return res.json({ q, source: 'youtube_live', suggestions: [] } satisfies SearchSuggestResponse);
  }

  try {
    const live = await musicSearch(q);
    const suggestions = buildSuggestions(live);
    res.set('Cache-Control', 'no-store');
    return res.json({ q, source: 'youtube_live', suggestions } satisfies SearchSuggestResponse);
  } catch {
    return res.status(500).json({ error: 'suggest_failed' });
  }
});

router.get('/results', async (req, res) => {
  const q = normalizeString(req.query.q);
  if (q.length < MIN_QUERY_CHARS) {
    return res.json({ q, source: 'youtube_live', sections: [] } satisfies SearchResultsResponse);
  }

  try {
    const live = await musicSearch(q);
    const sections = buildSections(live);
    res.set('Cache-Control', 'no-store');
    return res.json({ q, source: 'youtube_live', sections } satisfies SearchResultsResponse);
  } catch {
    return res.status(500).json({ error: 'search_failed' });
  }
});

export default router;
