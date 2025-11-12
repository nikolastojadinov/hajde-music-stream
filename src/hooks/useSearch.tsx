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
      if (!searchTerm || searchTerm.trim().length < 1) {
        return { tracks: [], playlists: [] };
      }

      // Tracks
      const { data: tracks, error: tracksError } = await supabase
        .from("tracks")
        .select("*")
        .or(`title.ilike.%${searchTerm}%,artist.ilike.%${searchTerm}%`)
        .limit(20);

      if (tracksError) {
        console.error("Tracks search error:", tracksError);
        return { tracks: [], playlists: [] };
      }

      // Playlists
      const { data: playlists, error: playlistsError } = await supabase
        .from("playlists")
        .select("*")
        .or(`title.ilike.%${searchTerm}%,description.ilike.%${searchTerm}%`)
        .limit(20);

      if (playlistsError) {
        console.error("Playlists search error:", playlistsError);
        return { tracks: tracks || [], playlists: [] };
      }

      return {
        tracks: tracks || [],
        playlists: playlists || [],
      };
    },
    enabled: searchTerm.length >= 1,
    retry: false,
  });
}
