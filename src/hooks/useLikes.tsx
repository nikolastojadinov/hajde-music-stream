import { useCallback, useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { usePi } from '@/contexts/PiContext';
import { usePremiumDialog } from '@/contexts/PremiumDialogContext';
import { getBackendOrigin } from '@/lib/backendUrl';

export type Track = {
  id: string;
  title?: string;
  artist?: string | null;
  cover_url?: string | null;
  external_id?: string | null;
  duration?: number | null;
};

export type Playlist = {
  id: string;
  title?: string;
  description?: string | null;
  cover_url?: string | null;
  region?: string | null;
  category?: string | null;
};

type LibraryState = {
  likedTracks: Track[];
  likedPlaylists: Playlist[];
};

const EMPTY_LIBRARY: LibraryState = {
  likedTracks: [],
  likedPlaylists: [],
};

type LibraryResponse = {
  success?: boolean;
  likedSongs?: RawLikedSong[];
  likedPlaylists?: RawLikedPlaylist[];
};

type RawLikedSong = {
  id: string | number;
  title?: string | null;
  artist?: string | null;
  cover_url?: string | null;
  external_id?: string | null;
  duration?: number | null;
};

type RawLikedPlaylist = {
  id: string | number;
  title?: string | null;
  description?: string | null;
  cover_url?: string | null;
  region?: string | null;
  category?: string | null;
};

function buildPiHeaders(user: { uid: string; username?: string; premium?: boolean; premium_until?: string | null } | null): Record<string, string> {
  return {
    'X-Pi-User-Id': user?.uid ?? '',
    'X-Pi-Username': user?.username ?? '',
    'X-Pi-Premium': user?.premium ? 'true' : 'false',
    'X-Pi-Premium-Until': user?.premium_until ?? '',
  };
}

type UseLikesReturn = {
  likedTracks: Track[];
  likedPlaylists: Playlist[];
  likedTrackIds: Set<string>;
  likedPlaylistIds: Set<string>;
  isTrackLiked: (trackId: string | null | undefined) => boolean;
  isPlaylistLiked: (playlistId: string | null | undefined) => boolean;
  toggleTrackLike: (trackId: string) => Promise<void>;
  togglePlaylistLike: (playlistId: string) => Promise<void>;
  loadAllLikes: () => Promise<void>;
};

export default function useLikes(): UseLikesReturn {
  const { user } = usePi();
  const { openDialog } = usePremiumDialog();
  const queryClient = useQueryClient();
  const backendUrl = useMemo(() => getBackendOrigin(), []);
  const libraryQueryKey = useMemo(() => ['library', backendUrl, user?.uid ?? 'guest'] as const, [backendUrl, user?.uid]);

  const { data: libraryData = EMPTY_LIBRARY } = useQuery<LibraryState>({
    queryKey: libraryQueryKey,
    queryFn: async () => {
      if (!user?.uid) {
        return EMPTY_LIBRARY;
      }

      try {
        console.log('[likes] GET', `${backendUrl}/library`);
        const resp = await fetch(`${backendUrl}/library`, {
          method: 'GET',
          cache: 'no-store',
          headers: { 'Content-Type': 'application/json', ...buildPiHeaders(user) },
        });
        console.log('[likes] /library response status:', resp.status);
        if (!resp.ok) {
          console.error('[likes] /library failed', { status: resp.status });
          return EMPTY_LIBRARY;
        }
        const json = await resp.json().catch(() => ({} as LibraryResponse));
        if (json?.success !== true) {
          console.error('[likes] /library error payload', json);
          return EMPTY_LIBRARY;
        }
        const songs: RawLikedSong[] = Array.isArray(json.likedSongs) ? json.likedSongs : [];
        const playlists: RawLikedPlaylist[] = Array.isArray(json.likedPlaylists) ? json.likedPlaylists : [];
        console.log('[likes] /library loaded', { songs: songs.length, playlists: playlists.length });
        return {
          likedTracks: songs.map((s: RawLikedSong) => ({
            id: String(s.id),
            title: s.title ?? '',
            artist: s.artist ?? null,
            cover_url: s.cover_url ?? null,
            external_id: s.external_id ?? null,
            duration: s.duration ?? null,
          })),
          likedPlaylists: playlists.map((p: RawLikedPlaylist) => ({
            id: String(p.id),
            title: p.title ?? '',
            description: p.description ?? null,
            cover_url: p.cover_url ?? null,
            region: p.region ?? null,
            category: p.category ?? null,
          })),
        } satisfies LibraryState;
      } catch (error) {
        console.error('[likes] /library request failed', error);
        return EMPTY_LIBRARY;
      }
    },
    enabled: Boolean(user?.uid),
    refetchOnWindowFocus: false,
    staleTime: 30_000,
    gcTime: 5 * 60_000,
  });

  const likedTracks = libraryData.likedTracks;
  const likedPlaylists = libraryData.likedPlaylists;

  const likedTrackIds = useMemo(() => new Set(likedTracks.map(t => t.id)), [likedTracks]);
  const likedPlaylistIds = useMemo(() => new Set(likedPlaylists.map(p => p.id)), [likedPlaylists]);

  const loadAllLikes = useCallback(async () => {
    if (!user?.uid) {
      queryClient.setQueryData(libraryQueryKey, EMPTY_LIBRARY);
      return;
    }

    await queryClient.invalidateQueries({ queryKey: libraryQueryKey });
  }, [user, queryClient, libraryQueryKey]);

  const shouldBlockForPremium = useCallback(() => {
    if (!user || !user.premium) {
      openDialog();
      return true;
    }
    return false;
  }, [user, openDialog]);

  const isTrackLiked = useCallback((trackId: string | null | undefined) => {
    if (!trackId) return false;
    return likedTrackIds.has(trackId);
  }, [likedTrackIds]);

  const isPlaylistLiked = useCallback((playlistId: string | null | undefined) => {
    if (!playlistId) return false;
    return likedPlaylistIds.has(playlistId);
  }, [likedPlaylistIds]);

  const toggleTrackLike = useCallback(async (trackId: string) => {
    if (shouldBlockForPremium()) return;
    if (!user?.uid || !trackId) return;
    const currentlyLiked = likedTrackIds.has(trackId);

    const previous = queryClient.getQueryData<LibraryState>(libraryQueryKey) ?? EMPTY_LIBRARY;
    const snapshot: LibraryState = {
      likedTracks: [...previous.likedTracks],
      likedPlaylists: [...previous.likedPlaylists],
    };

    queryClient.setQueryData<LibraryState>(libraryQueryKey, () => {
      const nextTracks = currentlyLiked
        ? snapshot.likedTracks.filter(t => t.id !== trackId)
        : snapshot.likedTracks.some(t => t.id === trackId)
          ? snapshot.likedTracks
          : [{ id: trackId }, ...snapshot.likedTracks];

      return {
        likedTracks: nextTracks,
        likedPlaylists: snapshot.likedPlaylists,
      };
    });

    const method = currentlyLiked ? 'DELETE' : 'POST';
    try {
      const url = `${backendUrl}/likes/songs/${trackId}`;
      console.log('[likes] track toggle', { trackId, method, url });
      const resp = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json', ...buildPiHeaders(user) },
      });
      const json = await resp.json().catch(() => ({}));
      if (!resp.ok || json?.success !== true) {
        console.error('[likes] track toggle failed', { status: resp.status, json });
        queryClient.setQueryData(libraryQueryKey, snapshot);
        return;
      }
      console.log('[likes] track toggle success');
      await loadAllLikes();
    } catch (error) {
      console.error('[likes] track toggle exception', error);
      queryClient.setQueryData(libraryQueryKey, snapshot);
    }
  }, [shouldBlockForPremium, user, likedTrackIds, backendUrl, queryClient, libraryQueryKey, loadAllLikes]);

  const togglePlaylistLike = useCallback(async (playlistId: string) => {
    if (shouldBlockForPremium()) return;
    if (!user?.uid || !playlistId) return;
    const currentlyLiked = likedPlaylistIds.has(playlistId);

    const previous = queryClient.getQueryData<LibraryState>(libraryQueryKey) ?? EMPTY_LIBRARY;
    const snapshot: LibraryState = {
      likedTracks: [...previous.likedTracks],
      likedPlaylists: [...previous.likedPlaylists],
    };

    queryClient.setQueryData<LibraryState>(libraryQueryKey, () => {
      const nextPlaylists = currentlyLiked
        ? snapshot.likedPlaylists.filter(p => p.id !== playlistId)
        : snapshot.likedPlaylists.some(p => p.id === playlistId)
          ? snapshot.likedPlaylists
          : [{ id: playlistId }, ...snapshot.likedPlaylists];

      return {
        likedTracks: snapshot.likedTracks,
        likedPlaylists: nextPlaylists,
      };
    });

    const method = currentlyLiked ? 'DELETE' : 'POST';
    try {
      const url = `${backendUrl}/likes/playlists/${playlistId}`;
      console.log('[likes] playlist toggle', { playlistId, method, url });
      const resp = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json', ...buildPiHeaders(user) },
      });
      const json = await resp.json().catch(() => ({}));
      if (!resp.ok || json?.success !== true) {
        console.error('[likes] playlist toggle failed', { status: resp.status, json });
        queryClient.setQueryData(libraryQueryKey, snapshot);
        return;
      }
      console.log('[likes] playlist toggle success');
      await loadAllLikes();
    } catch (error) {
      console.error('[likes] playlist toggle exception', error);
      queryClient.setQueryData(libraryQueryKey, snapshot);
    }
  }, [shouldBlockForPremium, user, likedPlaylistIds, backendUrl, queryClient, libraryQueryKey, loadAllLikes]);

  return {
    likedTracks,
    likedPlaylists,
    likedTrackIds,
    likedPlaylistIds,
    isTrackLiked,
    isPlaylistLiked,
    toggleTrackLike,
    togglePlaylistLike,
    loadAllLikes,
  };
}
