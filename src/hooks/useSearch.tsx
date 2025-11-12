import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

interface Track {
  id: string;
  title: string;
  artist: string;
  youtube_id: string;
  duration: number | null;
  image_url: string | null;
  playlist_id: string | null;
}

interface Playlist {
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
  return useQuery({
    queryKey: ["search", searchTerm],
    queryFn: async (): Promise<SearchResults> => {
      if (!searchTerm || searchTerm.length < 1) {
        return { tracks: [], playlists: [] };
      }

      const searchPattern = `%${searchTerm}%`;

      // Search tracks
      const { data: tracks, error: tracksError } = await supabase
        .from("tracks")
        .select("*")
        .or(`title.ilike.${searchPattern},artist.ilike.${searchPattern}`)
        .limit(20);

      if (tracksError) throw tracksError;

      // Search playlists
      const { data: playlists, error: playlistsError } = await supabase
        .from("playlists")
        .select("*")
        .or(`title.ilike.${searchPattern},description.ilike.${searchPattern}`)
        .limit(20);

      if (playlistsError) throw playlistsError;

      return {
        tracks: tracks || [],
        playlists: playlists || [],
      };
    },
    enabled: searchTerm.length >= 1,
  });
}
