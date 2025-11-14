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
      if (!playlistId) {
        throw new Error('Playlist ID is required');
      }

      // Fetch playlist details from external Supabase
      const { data: playlistData, error: playlistError } = await externalSupabase
        .from('playlists')
        .select('*')
        .eq('id', playlistId)
        .single();

      if (playlistError) {
        console.error('Playlist fetch error:', playlistError);
        throw playlistError;
      }

      if (!playlistData) {
        throw new Error('Playlist not found');
      }

      // Fetch tracks - try playlist_cover first, fallback to all tracks
      let tracksData = null;
      let tracksError = null;
      
      // First try with playlist_cover if it exists
      const playlistCoverQuery = await externalSupabase
        .from('tracks')
        .select('*')
        .eq('playlist_cover', playlistData.cover_url)
        .order('created_at', { ascending: true });
      
      // If no tracks found with playlist_cover, return empty array
      tracksData = playlistCoverQuery.data;
      tracksError = playlistCoverQuery.error;

      if (tracksError) {
        console.error('Tracks fetch error:', tracksError);
        throw tracksError;
      }

      // Map tracks to expected format
      const tracks = (tracksData || []).map((track: any) => ({
        id: track.id,
        title: track.title,
        artist: track.artist,
        youtube_id: track.external_id || track.youtube_id,
        duration: track.duration,
        image_url: track.cover_url || track.image_url,
        playlist_id: playlistId,
      }));

      return {
        id: playlistData.id,
        title: playlistData.title,
        description: playlistData.description,
        category: playlistData.category,
        image_url: playlistData.cover_url,
        tracks,
      };
    },
    enabled: Boolean(playlistId),
    staleTime: 5 * 60 * 1000,
    gcTime: 10 * 60 * 1000,
    refetchOnWindowFocus: false,
    refetchOnMount: false,
    retry: 1,
  });
};
