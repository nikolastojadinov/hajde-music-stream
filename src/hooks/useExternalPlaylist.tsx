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

      console.log('🔍 Fetching playlist:', playlistId);

      // Fetch playlist details from external Supabase
      const { data: playlistData, error: playlistError } = await externalSupabase
        .from('playlists')
        .select('*')
        .eq('id', playlistId)
        .single();

      if (playlistError) {
        console.error('❌ Playlist fetch error:', playlistError);
        throw new Error(`Failed to fetch playlist: ${playlistError.message}`);
      }

      if (!playlistData) {
        throw new Error('Playlist not found');
      }

      console.log('✅ Playlist found:', playlistData.title);

      let tracks: Track[] = [];

      // METHOD 1: Try playlist_tracks junction table
      console.log('🔄 Method 1: Trying playlist_tracks junction table...');
      const { data: playlistTracks, error: junctionError } = await externalSupabase
        .from('playlist_tracks')
        .select(`
          position,
          track_id,
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
        console.log(`📦 Found ${playlistTracks.length} tracks via junction table`);
        
        const mappedTracks = playlistTracks
          .map((pt: any) => {
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
          })
          .filter(Boolean) as Track[];
        
        if (mappedTracks.length > 0) {
          tracks = mappedTracks;
          console.log('✅ Using tracks from junction table:', tracks.length);
        }
      } else {
        console.warn('⚠️ Junction table method failed or returned no results');
      }

      // METHOD 2: If no tracks found, try direct playlist_id in tracks table
      if (tracks.length === 0) {
        console.log('🔄 Method 2: Trying direct playlist_id in tracks table...');
        const { data: directTracks, error: directError } = await externalSupabase
          .from('tracks')
          .select('id, title, artist, cover_url, duration, external_id')
          .eq('playlist_id', playlistId)
          .order('created_at', { ascending: true });

        if (!directError && directTracks && directTracks.length > 0) {
          console.log(`📦 Found ${directTracks.length} tracks via direct method`);
          tracks = directTracks.map((t: any) => ({
            id: t.id,
            title: t.title,
            artist: t.artist,
            youtube_id: t.external_id,
            duration: t.duration,
            image_url: t.cover_url,
            playlist_id: playlistId,
          }));
          console.log('✅ Using tracks from direct method:', tracks.length);
        } else {
          console.warn('⚠️ Direct method failed or returned no results');
        }
      }

      // METHOD 3: Try matching external_id
      if (tracks.length === 0 && playlistData.external_id) {
        console.log('🔄 Method 3: Trying external_id match...');
        const { data: externalTracks, error: externalError } = await externalSupabase
          .from('tracks')
          .select('id, title, artist, cover_url, duration, external_id')
          .eq('playlist_external_id', playlistData.external_id)
          .order('created_at', { ascending: true });

        if (!externalError && externalTracks && externalTracks.length > 0) {
          console.log(`📦 Found ${externalTracks.length} tracks via external_id`);
          tracks = externalTracks.map((t: any) => ({
            id: t.id,
            title: t.title,
            artist: t.artist,
            youtube_id: t.external_id,
            duration: t.duration,
            image_url: t.cover_url,
            playlist_id: playlistId,
          }));
          console.log('✅ Using tracks from external_id method:', tracks.length);
        } else {
          console.warn('⚠️ External_id method failed or returned no results');
        }
      }

      if (tracks.length === 0) {
        console.warn('⚠️ No tracks found for playlist:', playlistId);
      }

      console.log(`🎵 Final track count: ${tracks.length}`);

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
