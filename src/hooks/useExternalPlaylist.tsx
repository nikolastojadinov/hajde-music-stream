import { useQuery } from '@tanstack/react-query';
import { externalSupabase } from '@/lib/externalSupabase';

export interface Track {
  id: string;
  title: string;
  artist: string;
  external_id: string;
  youtube_id: string | null;
  sync_status: string | null;
  broken: boolean | null;
  unstable: boolean | null;
  duration: number | null;
  cover_url: string | null;
  playlist_id: string | null;
}

export interface Playlist {
  id: string;
  title: string;
  description: string | null;
  category: string | null;
  cover_url: string | null;
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

      const { data: playlistData, error: playlistError } =
        await externalSupabase
          .from('playlists')
          .select('*')
          .eq('id', playlistId)
          .single();

      if (playlistError || !playlistData) {
        throw new Error('Failed to fetch playlist');
      }

      let tracks: Track[] = [];

      // ===== METHOD 1: playlist_tracks junction table =====
      const { data: playlistTracks } = await externalSupabase
        .from('playlist_tracks')
        .select(`
          position,
          tracks (
            id,
            title,
            artist,
            cover_url,
            duration,
            external_id,
            youtube_id,
            sync_status,
            broken,
            unstable
          )
        `)
        .eq('playlist_id', playlistId)
        .order('position', { ascending: true });

      if (playlistTracks && playlistTracks.length > 0) {
        tracks = playlistTracks
          .map((pt: any) => {
            if (!pt.tracks) return null;
            return {
              ...pt.tracks,
              playlist_id: playlistId,
            };
          })
          .filter(Boolean) as Track[];
      }

      // ===== METHOD 2: direct playlist_id =====
      if (tracks.length === 0) {
        const { data: directTracks } = await externalSupabase
          .from('tracks')
          .select(`
            id,
            title,
            artist,
            cover_url,
            duration,
            external_id,
            youtube_id,
            sync_status,
            broken,
            unstable
          `)
          .eq('playlist_id', playlistId)
          .order('created_at', { ascending: true });

        if (directTracks && directTracks.length > 0) {
          tracks = directTracks.map((t: any) => ({
            ...t,
            playlist_id: playlistId,
          }));
        }
      }

      // ===== METHOD 3: external_id fallback =====
      if (tracks.length === 0 && playlistData.external_id) {
        const { data: externalTracks } = await externalSupabase
          .from('tracks')
          .select(`
            id,
            title,
            artist,
            cover_url,
            duration,
            external_id,
            youtube_id,
            sync_status,
            broken,
            unstable
          `)
          .eq('playlist_external_id', playlistData.external_id)
          .order('created_at', { ascending: true });

        if (externalTracks && externalTracks.length > 0) {
          tracks = externalTracks.map((t: any) => ({
            ...t,
            playlist_id: playlistId,
          }));
        }
      }

      // ===== 🔥 CENTRAL PLAYABLE FILTER (KLJUČNO) =====
      const playableTracks = tracks.filter(
        (t) =>
          t.external_id &&
          t.youtube_id &&
          t.sync_status === 'fetched' &&
          t.broken !== true &&
          t.unstable !== true
      );

      console.log(
        `🎧 Playable tracks: ${playableTracks.length} / ${tracks.length}`
      );

      return {
        id: playlistData.id,
        title: playlistData.title,
        description: playlistData.description,
        category: playlistData.category,
        cover_url: playlistData.cover_url || null,
        tracks: playableTracks,
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
