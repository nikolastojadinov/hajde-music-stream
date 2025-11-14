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

      // Fetch tracks through playlist_tracks junction table
      const { data: playlistTracks, error: tracksError } = await externalSupabase
        .from('playlist_tracks')
        .select(`
          position,
          tracks (
            id,
            title,
            artist,
            cover_url,
            duration,
            external_id
          )
        `)
        .eq('playlist_id', playlistId)
        .order('position', { ascending: true});

      if (tracksError) {
        console.error('Tracks fetch error:', tracksError);
        throw tracksError;
      }

      // Map tracks to expected format
      const tracks = (playlistTracks || []).map((pt: any) => {
        if (!pt.tracks) return null;
        return {
          id: pt.tracks.id,
          title: pt.tracks.title,
          artist: pt.tracks.artist,
          youtube_id: pt.tracks.external_id,
          duration: pt.tracks.duration,
          image_url: pt.tracks.cover_url,
          playlist_id: playlistId,
        };
      }).filter(Boolean) as Track[];

      return {
        id: playlistData.id,
        title: playlistData.title,
        description: playlistData.description,
        category: playlistData.category,
        image_url: playlistData.cover_url || playlistData.image_url || null,
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
