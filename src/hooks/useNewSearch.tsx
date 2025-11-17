import { useQuery } from '@tanstack/react-query';
import { externalSupabase } from '@/lib/externalSupabase';

export interface SearchTrack {
  type: 'track';
  id: string;
  title: string;
  artist: string;
  youtube_id: string;
  image_url: string | null;
  cover_url: string | null;
}

export interface SearchPlaylist {
  type: 'playlist';
  id: string;
  title: string;
  description: string | null;
  image_url: string | null;
  cover_url: string | null;
  track_count: number;
}

export interface SearchResults {
  songs: SearchTrack[];
  playlists: SearchPlaylist[];
  artistGroups: {
    artist: string;
    tracks: SearchTrack[];
  }[];
}

export function useNewSearch(searchTerm: string) {
  const term = (searchTerm ?? '').trim();

  return useQuery<SearchResults>({
    queryKey: ['newSearch', term],
    enabled: Boolean(term),
    retry: false,
    staleTime: 1000 * 60, // 1 minuta cache
    queryFn: async () => {
      if (!term) {
        return { songs: [], playlists: [], artistGroups: [] };
      }

      const pattern = `%${term}%`;

      // Single combined query for tracks and playlists
      const [tracksRes, playlistsWithCountRes] = await Promise.all([
        // Query 1: Tracks sa title ili artist ILIKE match
        externalSupabase
          .from('tracks')
          .select('id, title, artist, youtube_id, image_url, cover_url')
          .or(`title.ilike.${pattern},artist.ilike.${pattern}`)
          .order('title', { ascending: true }),

        // Query 2: Playlists sa JOIN-om za brojanje track_count
        externalSupabase
          .from('playlists')
          .select('id, title, description, image_url, cover_url, playlist_tracks(count)')
          .ilike('title', pattern)
          .order('title', { ascending: true }),
      ]);

      if (tracksRes.error) {
        console.error('Tracks query error:', tracksRes.error);
        throw tracksRes.error;
      }

      if (playlistsWithCountRes.error) {
        console.error('Playlists query error:', playlistsWithCountRes.error);
        throw playlistsWithCountRes.error;
      }

      // Procesiranje tracks
      const allTracks = (tracksRes.data || []).map((track: any) => ({
        type: 'track' as const,
        id: track.id,
        title: track.title,
        artist: track.artist,
        youtube_id: track.youtube_id,
        image_url: track.image_url,
        cover_url: track.cover_url,
      }));

      // Procesiranje playlists - filtriranje onih sa track_count > 0
      const validPlaylists = (playlistsWithCountRes.data || [])
        .filter((playlist: any) => {
          const trackCount = playlist.playlist_tracks?.[0]?.count || 0;
          return trackCount > 0;
        })
        .map((playlist: any) => ({
          type: 'playlist' as const,
          id: playlist.id,
          title: playlist.title,
          description: playlist.description,
          image_url: playlist.image_url,
          cover_url: playlist.cover_url,
          track_count: playlist.playlist_tracks?.[0]?.count || 0,
        }));

      // Razdvajanje na SONGS (title match) i ARTISTS (artist match)
      const songs: SearchTrack[] = [];
      const artistMatchTracks: SearchTrack[] = [];

      allTracks.forEach((track: SearchTrack) => {
        const titleMatch = track.title.toLowerCase().includes(term.toLowerCase());
        const artistMatch = track.artist.toLowerCase().includes(term.toLowerCase());

        if (titleMatch) {
          songs.push(track);
        }
        
        if (artistMatch) {
          artistMatchTracks.push(track);
        }
      });

      // Grupisanje po artistima
      const artistMap = new Map<string, SearchTrack[]>();
      artistMatchTracks.forEach(track => {
        const existing = artistMap.get(track.artist) || [];
        artistMap.set(track.artist, [...existing, track]);
      });

      const artistGroups = Array.from(artistMap.entries())
        .map(([artist, tracks]) => ({
          artist,
          tracks: tracks.sort((a, b) => a.title.localeCompare(b.title)),
        }))
        .sort((a, b) => a.artist.localeCompare(b.artist));

      return {
        songs,
        playlists: validPlaylists,
        artistGroups,
      };
    },
  });
}
