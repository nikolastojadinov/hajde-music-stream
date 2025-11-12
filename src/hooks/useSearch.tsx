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
      console.log("useSearch called with:", searchTerm);
      
      if (!searchTerm || searchTerm.trim().length < 1) {
        console.log("Search term too short, returning empty");
        return { tracks: [], playlists: [] };
      }

      const pattern = `%${searchTerm.trim()}%`;
      console.log("Search pattern:", pattern);

      // Search tracks by title
      const { data: tracksByTitle, error: titleError } = await supabase
        .from("tracks")
        .select("*")
        .ilike("title", pattern)
        .limit(20);
      
      console.log("Tracks by title:", tracksByTitle?.length, "Error:", titleError);

      // Search tracks by artist
      const { data: tracksByArtist, error: artistError } = await supabase
        .from("tracks")
        .select("*")
        .ilike("artist", pattern)
        .limit(20);
      
      console.log("Tracks by artist:", tracksByArtist?.length, "Error:", artistError);

      // Merge and deduplicate tracks
      const tracksMap = new Map();
      [...(tracksByTitle || []), ...(tracksByArtist || [])].forEach(track => {
        tracksMap.set(track.id, track);
      });
      const tracks = Array.from(tracksMap.values()).slice(0, 20);

      // Search playlists by title
      const { data: playlistsByTitle } = await supabase
        .from("playlists")
        .select("*")
        .ilike("title", pattern)
        .limit(20);

      // Search playlists by description
      const { data: playlistsByDesc } = await supabase
        .from("playlists")
        .select("*")
        .ilike("description", pattern)
        .limit(20);

      // Merge and deduplicate playlists
      const playlistsMap = new Map();
      [...(playlistsByTitle || []), ...(playlistsByDesc || [])].forEach(playlist => {
        playlistsMap.set(playlist.id, playlist);
      });
      const playlists = Array.from(playlistsMap.values()).slice(0, 20);

      console.log("Final results - Tracks:", tracks.length, "Playlists:", playlists.length);
      
      return {
        tracks,
        playlists,
      };
    },
    enabled: searchTerm.trim().length >= 1,
    retry: false,
  });
}
