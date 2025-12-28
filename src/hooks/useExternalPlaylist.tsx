import { useQuery } from '@tanstack/react-query';
import { withBackendOrigin } from '@/lib/backendUrl';

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

      const url = withBackendOrigin(`/api/playlists/${playlistId}`);
      const res = await fetch(url, { credentials: 'include' });

      if (res.status === 404) {
        throw new Error('Playlist not found');
      }

      if (!res.ok) {
        throw new Error('Failed to load playlist');
      }

      const json = await res.json();

      const tracks: Track[] = Array.isArray(json?.tracks)
        ? json.tracks
            .map((t: any) => ({
              id: String(t?.id ?? ''),
              title: String(t?.title ?? ''),
              artist: String(t?.artist ?? ''),
              external_id: t?.external_id ? String(t.external_id) : '',
              duration: typeof t?.duration === 'number' && Number.isFinite(t.duration) ? t.duration : null,
              cover_url: t?.cover_url ?? null,
              playlist_id: playlistId,
            }))
            .filter((t) => t.id && t.title)
        : [];

      return {
        id: String(json?.id ?? playlistId),
        title: json?.title ?? '',
        description: json?.description ?? null,
        category: json?.category ?? null,
        cover_url: json?.cover_url ?? null,
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
