import { useQuery } from '@tanstack/react-query';
import { externalSupabase } from '@/lib/externalSupabase';

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

export interface PlaylistWithTracks extends Playlist {
  tracks: Track[];
}

export const useExternalPlaylist = (playlistId: string) => {
  return useQuery<PlaylistWithTracks>({
    queryKey: ['external-playlist', playlistId],
    queryFn: async () => {
      // Fetch playlist details
      const { data: playlistData, error: playlistError } = await externalSupabase
        .from('playlists')
        .select('id, title, description, category, image_url')
        .eq('id', playlistId)
        .single();

      if (playlistError) throw playlistError;

      // Fetch tracks for this playlist
      const { data: tracksData, error: tracksError } = await externalSupabase
        .from('tracks')
        .select('*')
        .eq('playlist_id', playlistId)
        .order('created_at', { ascending: true });

      if (tracksError) throw tracksError;

      return {
        ...playlistData,
        tracks: tracksData || [],
      };
    },
    enabled: Boolean(playlistId),
  });
};
