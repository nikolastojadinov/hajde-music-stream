import { Router } from 'express';
import { musicSearch, type MusicSearchAlbum, type MusicSearchArtist, type MusicSearchPlaylist, type MusicSearchResults, type MusicSearchTrack } from '../services/youtubeMusicClient';

const router = Router();

const MIN_QUERY_CHARS = 2;
const MAX_SUGGESTIONS = 20;

type SuggestionType = 'artist' | 'track' | 'album' | 'playlist';

export type SearchSuggestItem = {
  type: SuggestionType;
  id: string;
  name: string;
  imageUrl?: string;
  subtitle: string;
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
  sections: {
    songs: SearchResultItem[];
    artists: SearchResultItem[];
    albums: SearchResultItem[];
    playlists: SearchResultItem[];
  };
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

function looksLikeBrowseId(value: string): boolean {
  const v = value.trim();
  if (!v || v.includes(' ')) return false;
  return /^(OLAK|PL|VL|RD|MP|UU|LL|UC|OL|RV)[A-Za-z0-9_-]+$/i.test(v);
}

function buildTrackSuggestion(track: MusicSearchTrack): SearchSuggestItem | null {
  if (!isVideoId(track.youtubeId) || !isNonEmpty(track.title)) return null;
  return {
    type: 'track',
    id: track.youtubeId,
    name: track.title.trim(),
    imageUrl: isNonEmpty(track.imageUrl) ? track.imageUrl : undefined,
    subtitle: isNonEmpty(track.artist) ? track.artist : 'Song',
  };
}

function buildArtistSuggestion(artist: MusicSearchArtist): SearchSuggestItem | null {
  if (!isNonEmpty(artist.id) || !isNonEmpty(artist.name)) return null;
  return {
    type: 'artist',
    id: artist.id.trim(),
    name: artist.name.trim(),
    imageUrl: isNonEmpty(artist.imageUrl) ? artist.imageUrl : undefined,
    subtitle: 'Artist',
  };
}

function buildAlbumSuggestion(album: MusicSearchAlbum): SearchSuggestItem | null {
  if (!isNonEmpty(album.id) || !isNonEmpty(album.title)) return null;
  return {
    type: 'album',
    id: album.id.trim(),
    name: album.title.trim(),
    imageUrl: isNonEmpty(album.imageUrl) ? album.imageUrl : undefined,
    subtitle: isNonEmpty(album.channelTitle) ? album.channelTitle : 'Album',
  };
}

function buildPlaylistSuggestion(playlist: MusicSearchPlaylist): SearchSuggestItem | null {
  if (!isNonEmpty(playlist.id) || !isNonEmpty(playlist.title)) return null;
  return {
    type: 'playlist',
    id: playlist.id.trim(),
    name: playlist.title.trim(),
    imageUrl: isNonEmpty(playlist.imageUrl) ? playlist.imageUrl : undefined,
    subtitle: isNonEmpty(playlist.channelTitle) ? playlist.channelTitle : 'Playlist',
  };
}

function dedupePush<T extends { id: string }>(list: T[], seen: Set<string>, item: T): void {
  const key = item.id.trim();
  if (!key || seen.has(key)) return;
  seen.add(key);
  list.push(item);
}

function buildSuggestions(live: MusicSearchResults): SearchSuggestItem[] {
  const sources: Array<SearchSuggestItem[]> = [
    (live.tracks || []).map(buildTrackSuggestion).filter(Boolean) as SearchSuggestItem[],
    (live.artists || []).map(buildArtistSuggestion).filter(Boolean) as SearchSuggestItem[],
    (live.playlists || []).map(buildPlaylistSuggestion).filter(Boolean) as SearchSuggestItem[],
    (live.albums || []).map(buildAlbumSuggestion).filter(Boolean) as SearchSuggestItem[],
  ];

  const pointers = new Array(sources.length).fill(0);
  const suggestions: SearchSuggestItem[] = [];
  const seen = new Set<string>();

  while (suggestions.length < MAX_SUGGESTIONS) {
    let progressed = false;

    for (let i = 0; i < sources.length && suggestions.length < MAX_SUGGESTIONS; i += 1) {
      const src = sources[i];
      let ptr = pointers[i];
      while (ptr < src.length && suggestions.length < MAX_SUGGESTIONS) {
        const candidate = src[ptr];
        ptr += 1;
        if (candidate && !seen.has(candidate.id)) {
          dedupePush(suggestions, seen, candidate);
          progressed = true;
          break;
        }
      }
      pointers[i] = ptr;
    }

    const remaining = sources.some((src, idx) => pointers[idx] < src.length);
    if (!progressed || !remaining) break;
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
  const songs = mapTracks(live.tracks || []);
  const artists = mapArtists(live.artists || []);
  const albums = mapAlbums(live.albums || []);
  const playlists = mapPlaylists(live.playlists || []);

  return { songs, artists, albums, playlists };
}

router.get('/suggest', async (req, res) => {
  const q = normalizeString(req.query.q);
  if (q.length < MIN_QUERY_CHARS) {
    return res.json({ q, source: 'youtube_live', suggestions: [] } satisfies SearchSuggestResponse);
  }

  if (looksLikeBrowseId(q)) {
    return res.status(400).json({ error: 'invalid_query' });
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
    return res.json({ q, source: 'youtube_live', sections: { songs: [], artists: [], albums: [], playlists: [] } } satisfies SearchResultsResponse);
  }

  if (looksLikeBrowseId(q)) {
    return res.status(400).json({ error: 'invalid_query' });
  }

  try {
    const live = await musicSearch(q);
    const sections = buildSections(live);
    console.info('[search/results] parsed_counts', {
      q,
      songs: sections.songs.length,
      artists: sections.artists.length,
      albums: sections.albums.length,
      playlists: sections.playlists.length,
    });
    res.set('Cache-Control', 'no-store');
    return res.json({ q, source: 'youtube_live', sections } satisfies SearchResultsResponse);
  } catch {
    return res.status(500).json({ error: 'search_failed' });
  }
});

export default router;
