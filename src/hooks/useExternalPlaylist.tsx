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
        .select('id, title, description, category, cover_url')
        .eq('id', playlistId)
        .single();

      if (playlistError) throw playlistError;

      // Fetch tracks for this playlist using playlist_cover instead of playlist_id
      const { data: tracksData, error: tracksError } = await externalSupabase
        .from('tracks')
        .select('*')
        .eq('playlist_cover', playlistData.cover_url)
        .order('created_at', { ascending: true });

      if (tracksError) throw tracksError;

      return {
        ...playlistData,
        image_url: playlistData.cover_url,
        tracks: tracksData || [],
      };
    },
    enabled: Boolean(playlistId),
    staleTime: 5 * 60 * 1000, // Podaci ostaju fresh 5 minuta
    gcTime: 10 * 60 * 1000, // Cache se čuva 10 minuta
    refetchOnWindowFocus: false, // Ne refetch-uj pri vraćanju fokusa
    refetchOnMount: false, // Ne refetch-uj pri svakom mount-u ako su podaci fresh
  });
};
