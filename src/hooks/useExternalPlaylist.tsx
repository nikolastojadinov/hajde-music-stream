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

      console.log('🔍 [useExternalPlaylist] Fetching playlist:', playlistId);

      // Step 1: Fetch playlist metadata
      const { data: playlistData, error: playlistError } = await externalSupabase
        .from('playlists')
        .select('id, title, description, category, cover_url')
        .eq('id', playlistId)
        .single();

      if (playlistError) {
        console.error('❌ [useExternalPlaylist] Playlist fetch error:', playlistError);
        throw new Error(`Failed to fetch playlist: ${playlistError.message}`);
      }

      if (!playlistData) {
        throw new Error('Playlist not found');
      }

      console.log('✅ [useExternalPlaylist] Playlist found:', playlistData.title);

      // Step 2: Fetch tracks via playlist_tracks junction table
      console.log('🔄 [useExternalPlaylist] Fetching tracks from playlist_tracks...');
      
      const { data: junctionData, error: junctionError } = await externalSupabase
        .from('playlist_tracks')
        .select('track_id, position')
        .eq('playlist_id', playlistId)
        .order('position', { ascending: true });

      if (junctionError) {
        console.error('❌ [useExternalPlaylist] Junction table error:', junctionError);
        throw new Error(`Failed to fetch playlist tracks: ${junctionError.message}`);
      }

      console.log(`📦 [useExternalPlaylist] Found ${junctionData?.length || 0} junction records`);

      let tracks: Track[] = [];

      if (junctionData && junctionData.length > 0) {
        // Extract track IDs
        const trackIds = junctionData.map((item) => item.track_id);
        console.log(`🔑 [useExternalPlaylist] Track IDs to fetch:`, trackIds);

        // Step 3: Fetch actual track details
        const { data: tracksData, error: tracksError } = await externalSupabase
          .from('tracks')
          .select('*')
          .in('id', trackIds);

        if (tracksError) {
          console.error('❌ [useExternalPlaylist] Tracks fetch error:', tracksError);
          throw new Error(`Failed to fetch track details: ${tracksError.message}`);
        }

        console.log(`📦 [useExternalPlaylist] Loaded ${tracksData?.length || 0} track details`);

        if (tracksData && tracksData.length > 0) {
          console.log('📦 [useExternalPlaylist] First track from DB:', tracksData[0]);
          console.log('📦 [useExternalPlaylist] Track fields:', Object.keys(tracksData[0]));
          
          // Create a map for quick lookup
          const tracksMap = new Map(tracksData.map((t) => [t.id, t]));

          // Map junction data to track details, preserving order
          tracks = junctionData
            .map((junction) => {
              const trackDetail = tracksMap.get(junction.track_id);
              if (!trackDetail) {
                console.warn(`⚠️ [useExternalPlaylist] Track not found for ID: ${junction.track_id}`);
                return null;
              }
              
              const youtubeId = trackDetail.external_id || trackDetail.video_id || trackDetail.youtube_id || '';
              console.log(`🔍 [useExternalPlaylist] Track "${trackDetail.title}":`, {
                external_id: trackDetail.external_id,
                video_id: trackDetail.video_id,
                youtube_id: trackDetail.youtube_id,
                final: youtubeId
              });
              
              return {
                id: trackDetail.id,
                title: trackDetail.title,
                artist: trackDetail.artist,
                youtube_id: youtubeId,
                duration: trackDetail.duration,
                image_url: trackDetail.cover_url || null,
                playlist_id: playlistId,
              };
            })
            .filter(Boolean) as Track[];

          console.log(`✅ [useExternalPlaylist] Mapped ${tracks.length} tracks with correct order`);
          console.log('✅ [useExternalPlaylist] First mapped track:', tracks[0]);
        }
      } else {
        console.warn('⚠️ [useExternalPlaylist] No junction records found, trying fallback...');

        // FALLBACK: Try direct playlist_id in tracks table
        const { data: directTracks, error: directError } = await externalSupabase
          .from('tracks')
          .select('*')
          .eq('playlist_id', playlistId)
          .order('created_at', { ascending: true });

        if (!directError && directTracks && directTracks.length > 0) {
          console.log(`📦 [useExternalPlaylist] Found ${directTracks.length} tracks via fallback method`);
          tracks = directTracks.map((t) => ({
            id: t.id,
            title: t.title,
            artist: t.artist,
            youtube_id: t.external_id || t.video_id || '',
            duration: t.duration,
            image_url: t.cover_url || null,
            playlist_id: playlistId,
          }));
        } else {
          console.warn('⚠️ [useExternalPlaylist] Fallback method also returned no results');
        }
      }

      console.log(`🎵 [useExternalPlaylist] Final track count: ${tracks.length}`);

      return {
        id: playlistData.id,
        title: playlistData.title,
        description: playlistData.description,
        category: playlistData.category,
        image_url: playlistData.cover_url || null,
        tracks,
      };
    },
    enabled: Boolean(playlistId),
    staleTime: 5 * 60 * 1000, // Cache for 5 minutes
    gcTime: 10 * 60 * 1000, // Keep in cache for 10 minutes
    refetchOnWindowFocus: false,
    refetchOnMount: false,
    retry: 1,
  });
};
