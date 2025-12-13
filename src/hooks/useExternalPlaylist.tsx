import { useQuery } from '@tanstack/react-query';
import { externalSupabase } from '@/lib/externalSupabase';

export interface Track {
  id: string;
  title: string;
  artist: string;
  external_id: string;
  duration: number | null;
  cover_url: string | null;
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
      if (!playlistId) throw new Error('Playlist ID is required');

      // 1️⃣ PLAYLIST
      const { data: playlist } = await externalSupabase
        .from('playlists')
        .select('*')
        .eq('id', playlistId)
        .single();

      if (!playlist) throw new Error('Playlist not found');

      // 2️⃣ TRACK IDS (junction table)
      const { data: links } = await externalSupabase
        .from('playlist_tracks')
        .select('track_id, position')
        .eq('playlist_id', playlistId)
        .order('position');

      if (!links || links.length === 0) {
        return { ...playlist, tracks: [] };
      }

      const trackIds = links.map(l => l.track_id);

      // 3️⃣ TRACKS (EXPLICIT FETCH)
      const { data: tracksData } = await externalSupabase
        .from('tracks')
        .select('id, title, artist, cover_url, duration, external_id, broken')
        .in('id', trackIds);

      if (!tracksData) {
        return { ...playlist, tracks: [] };
      }

      // 4️⃣ MAP + FILTER
      const tracks = links
        .map(link => tracksData.find(t => t.id === link.track_id))
        .filter(
          (t): t is Track =>
            !!t &&
            typeof t.external_id === 'string' &&
            t.external_id.length > 0 &&
            (t as any).broken !== true
        );

      return {
        id: playlist.id,
        title: playlist.title,
        description: playlist.description,
        category: playlist.category,
        cover_url: playlist.cover_url,
        tracks,
      };
    },
    enabled: Boolean(playlistId),
    staleTime: 300_000,
  });
};
