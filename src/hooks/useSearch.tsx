// Simplified live search hook: returns { tracks, playlists }
// Meets directive: no relevance scoring, no pattern escaping, limited Supabase queries.
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

export interface Track {
  id: string;
  title: string;
  artist: string;
  youtube_id: string;
  duration: number | null;
  image_url: string | null;
  playlist_id: string | null;
}

export interface Playlist {
  id: string;
  title: string;
  description: string | null;
  category: string | null;
  image_url: string | null;
}

export interface SearchResults {
  tracks: Track[];
  playlists: Playlist[];
}

export function useSearch(searchTerm: string) {
  const term = (searchTerm ?? '').trim();

  return useQuery<SearchResults>({
    queryKey: ['search', searchTerm],
    enabled: Boolean(term),
    retry: false,
    queryFn: async () => {
      // Guard: should not run when empty because enabled=false will prevent execution.
      if (!term) {
        return { tracks: [], playlists: [] };
      }

      const pattern = `%${term}%`;

      // Fetch tracks (title OR artist) & playlists (title OR description) in parallel, each limited.
      const [tracksTitleRes, tracksArtistRes, playlistsTitleRes, playlistsDescRes] = await Promise.all([
        supabase.from('tracks').select('*').ilike('title', pattern).limit(15),
        supabase.from('tracks').select('*').ilike('artist', pattern).limit(15),
        supabase.from('playlists').select('*').ilike('title', pattern).limit(15),
        supabase.from('playlists').select('*').ilike('description', pattern).limit(15),
      ]);

      if (tracksTitleRes.error) throw tracksTitleRes.error;
      if (tracksArtistRes.error) throw tracksArtistRes.error;
      if (playlistsTitleRes.error) throw playlistsTitleRes.error;
      if (playlistsDescRes.error) throw playlistsDescRes.error;

      // Deduplicate by id within each group.
      const tracksMap = new Map<string, Track>();
      [...(tracksTitleRes.data || []), ...(tracksArtistRes.data || [])].forEach(t => tracksMap.set(t.id, t as Track));
      const playlistsMap = new Map<string, Playlist>();
      [...(playlistsTitleRes.data || []), ...(playlistsDescRes.data || [])].forEach(p => playlistsMap.set(p.id, p as Playlist));

      const tracks = Array.from(tracksMap.values());
      const playlists = Array.from(playlistsMap.values());

      console.log('Search results:', { term: searchTerm, trackCount: tracks.length, playlistCount: playlists.length });

      return { tracks, playlists };
    },
  });
}
