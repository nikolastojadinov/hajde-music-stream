import { useQuery } from '@tanstack/react-query';
import { externalSupabase } from '@/lib/externalSupabase';

export interface Track {
  id: string;
  title: string;
  artist: string;
  external_id: string;
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
        throw new Error('Playlist not found');
      }

      let tracks: Track[] = [];

      // ✅ METHOD 1 (ostaje ista)
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
            external_id
          )
        `)
        .eq('playlist_id', playlistId)
        .order('position', { ascending: true });

      if (playlistTracks && playlistTracks.length > 0) {
        tracks = playlistTracks
          .map((pt: any) => {
            // 🔴 JEDINA BITNA ZAŠTITA
            if (!pt.tracks) return null;

            return {
              id: pt.tracks.id,
              title: pt.tracks.title,
              artist: pt.tracks.artist,
              external_id: pt.tracks.external_id,
              duration: pt.tracks.duration,
              cover_url: pt.tracks.cover_url,
              playlist_id: playlistId,
            };
          })
          .filter((t): t is Track => t !== null);
      }

      // METHOD 2 (ostaje ista)
      if (tracks.length === 0) {
        const { data: directTracks } = await externalSupabase
          .from('tracks')
          .select('id, title, artist, cover_url, duration, external_id')
          .eq('playlist_id', playlistId)
          .order('created_at', { ascending: true });

        if (directTracks && directTracks.length > 0) {
          tracks = directTracks.map((t: any) => ({
            id: t.id,
            title: t.title,
            artist: t.artist,
            external_id: t.external_id,
            duration: t.duration,
            cover_url: t.cover_url,
            playlist_id: playlistId,
          }));
        }
      }

      console.log(`🎵 Final track count: ${tracks.length}`);

      return {
        id: playlistData.id,
        title: playlistData.title,
        description: playlistData.description,
        category: playlistData.category,
        cover_url: playlistData.cover_url || null,
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
