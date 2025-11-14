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

      // Try multiple methods to fetch tracks
      let tracks: Track[] = [];
      
      // Method 1: Try playlist_tracks junction table
      try {
        const { data: playlistTracks, error: junctionError } = await externalSupabase
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
          .order('position', { ascending: true });

        if (!junctionError && playlistTracks && playlistTracks.length > 0) {
          tracks = playlistTracks.map((pt: any) => {
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
          
          console.log('✅ Tracks loaded via junction table:', tracks.length);
        }
      } catch (error) {
        console.warn('Junction table method failed, trying alternatives...');
      }

      // Method 2: If no tracks yet, try direct playlist_id reference
      if (tracks.length === 0) {
        try {
          const { data: directTracks, error: directError } = await externalSupabase
            .from('tracks')
            .select('*')
            .eq('playlist_id', playlistId)
            .order('created_at', { ascending: true });

          if (!directError && directTracks && directTracks.length > 0) {
            tracks = directTracks.map((track: any) => ({
              id: track.id,
              title: track.title,
              artist: track.artist,
              youtube_id: track.external_id || track.youtube_id,
              duration: track.duration,
              image_url: track.cover_url || track.image_url,
              playlist_id: playlistId,
            }));
            
            console.log('✅ Tracks loaded via direct playlist_id:', tracks.length);
          }
        } catch (error) {
          console.warn('Direct playlist_id method failed, trying next...');
        }
      }

      // Method 3: Try using external_id to find related tracks
      if (tracks.length === 0 && playlistData.external_id) {
        try {
          const { data: externalTracks, error: extError } = await externalSupabase
            .from('tracks')
            .select('*')
            .eq('playlist_external_id', playlistData.external_id)
            .order('created_at', { ascending: true });

          if (!extError && externalTracks && externalTracks.length > 0) {
            tracks = externalTracks.map((track: any) => ({
              id: track.id,
              title: track.title,
              artist: track.artist,
              youtube_id: track.external_id || track.youtube_id,
              duration: track.duration,
              image_url: track.cover_url || track.image_url,
              playlist_id: playlistId,
            }));
            
            console.log('✅ Tracks loaded via external_id:', tracks.length);
          }
        } catch (error) {
          console.warn('External ID method failed');
        }
      }

      console.log(`📊 Final track count for playlist ${playlistId}:`, tracks.length);

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
