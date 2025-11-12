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

      const pattern = `%${searchTerm.trim()}%`;

      const [tracksTitleRes, tracksArtistRes, playlistsTitleRes, playlistsDescRes] = await Promise.all([
        supabase.from("tracks").select("*").ilike("title", pattern).limit(20),
        supabase.from("tracks").select("*").ilike("artist", pattern).limit(20),
        supabase.from("playlists").select("*").ilike("title", pattern).limit(20),
        supabase.from("playlists").select("*").ilike("description", pattern).limit(20),
      ]);

      const tracksMap = new Map();
      [...(tracksTitleRes.data || []), ...(tracksArtistRes.data || [])].forEach(track => {
        tracksMap.set(track.id, track);
      });
      const tracks = Array.from(tracksMap.values()).slice(0, 20);

      const playlistsMap = new Map();
      [...(playlistsTitleRes.data || []), ...(playlistsDescRes.data || [])].forEach(playlist => {
        playlistsMap.set(playlist.id, playlist);
      });
      const playlists = Array.from(playlistsMap.values()).slice(0, 20);

      return { tracks, playlists };
    },
    enabled: searchTerm.trim().length >= 1,
    retry: false,
  });
}
