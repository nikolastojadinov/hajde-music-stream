import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export interface Track {
  id: string;
  title: string;
  artist: string;
  duration: number;
  youtube_id: string;
  playlist_id: string;
  image_url: string | null;
  created_at: string;
}

export interface PlaylistWithTracks {
  id: string;
  title: string;
  description: string | null;
  category: string | null;
  image_url: string | null;
  created_at: string;
  tracks: Track[];
}

export const usePlaylist = (playlistId: string | undefined) => {
  return useQuery({
    queryKey: ["playlist", playlistId],
    queryFn: async () => {
      if (!playlistId) throw new Error("Playlist ID is required");

      // Fetch playlist
      const { data: playlist, error: playlistError } = await supabase
        .from("playlists")
        .select("*")
        .eq("id", playlistId)
        .single();

      if (playlistError) throw playlistError;

      // Fetch tracks for this playlist
      const { data: tracks, error: tracksError } = await supabase
        .from("tracks")
        .select("*")
        .eq("playlist_id", playlistId)
        .order("created_at", { ascending: true });

      if (tracksError) throw tracksError;

      return {
        ...playlist,
        tracks: tracks || [],
      } as PlaylistWithTracks;
    },
    enabled: !!playlistId,
  });
};
