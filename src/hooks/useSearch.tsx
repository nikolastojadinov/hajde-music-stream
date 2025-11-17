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

      // Fetch ALL tracks and playlists from entire Supabase database - NO LIMIT
      // Use .or() to search across multiple fields in a single query
      const [tracksRes, playlistsRes] = await Promise.all([
        supabase
          .from('tracks')
          .select('*')
          .or(`title.ilike.${pattern},artist.ilike.${pattern}`),
        supabase
          .from('playlists')
          .select('*')
          .or(`title.ilike.${pattern},description.ilike.${pattern}`),
      ]);

      if (tracksRes.error) throw tracksRes.error;
      if (playlistsRes.error) throw playlistsRes.error;

      const tracks = (tracksRes.data || []) as Track[];
      const playlists = (playlistsRes.data || []) as Playlist[];

      return { tracks, playlists };
    },
  });
}
