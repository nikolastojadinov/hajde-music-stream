import { useState, useEffect, useCallback, useMemo } from 'react';
import { usePi } from '@/contexts/PiContext';

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
  const [likedTracks, setLikedTracks] = useState<Track[]>([]);
  const [likedPlaylists, setLikedPlaylists] = useState<Playlist[]>([]);

  const likedTrackIds = useMemo(() => new Set(likedTracks.map(t => t.id)), [likedTracks]);
  const likedPlaylistIds = useMemo(() => new Set(likedPlaylists.map(p => p.id)), [likedPlaylists]);

  const BACKEND_URL: string = ((window as any).__PI_BACKEND_URL__ as string) || import.meta.env.VITE_BACKEND_URL || '';

  const loadAllLikes = useCallback(async () => {
    if (!user?.uid) {
      setLikedTracks([]);
      setLikedPlaylists([]);
      return;
    }

    try {
      console.log('[likes] GET', `${BACKEND_URL}/library`);
      const resp = await fetch(`${BACKEND_URL}/library`, {
        method: 'GET',
        cache: 'no-store',
        headers: { 'Content-Type': 'application/json', ...buildPiHeaders(user) },
      });
      console.log('[likes] /library response status:', resp.status);
      if (!resp.ok) {
        console.error('[likes] /library failed', { status: resp.status });
        setLikedTracks([]);
        setLikedPlaylists([]);
        return;
      }
      const json = await resp.json().catch(() => ({}));
      if (json?.success !== true) {
        console.error('[likes] /library error payload', json);
        setLikedTracks([]);
        setLikedPlaylists([]);
        return;
      }
      const songs = Array.isArray(json.likedSongs) ? json.likedSongs : [];
      const playlists = Array.isArray(json.likedPlaylists) ? json.likedPlaylists : [];
      console.log('[likes] /library loaded', { songs: songs.length, playlists: playlists.length });
      setLikedTracks(songs.map((s: any) => ({
        id: String(s.id),
        title: s.title ?? '',
        artist: s.artist ?? null,
        cover_url: s.cover_url ?? null,
        external_id: s.external_id ?? null,
        duration: s.duration ?? null,
      })));
      setLikedPlaylists(playlists.map((p: any) => ({
        id: String(p.id),
        title: p.title ?? '',
        description: p.description ?? null,
        cover_url: p.cover_url ?? null,
        region: p.region ?? null,
        category: p.category ?? null,
      })));
    } catch (_e) {
      setLikedTracks([]);
      setLikedPlaylists([]);
    }
  }, [user?.uid, BACKEND_URL]);

  useEffect(() => {
    loadAllLikes();
  }, [loadAllLikes]);

  const isTrackLiked = useCallback((trackId: string | null | undefined) => {
    if (!trackId) return false;
    return likedTrackIds.has(trackId);
  }, [likedTrackIds]);

  const isPlaylistLiked = useCallback((playlistId: string | null | undefined) => {
    if (!playlistId) return false;
    return likedPlaylistIds.has(playlistId);
  }, [likedPlaylistIds]);

  const toggleTrackLike = useCallback(async (trackId: string) => {
    if (!user?.uid || !trackId) return;
    const currentlyLiked = likedTrackIds.has(trackId);

    const previous = likedTracks;
    if (currentlyLiked) {
      setLikedTracks(prev => prev.filter(t => t.id !== trackId));
    } else {
      setLikedTracks(prev => (prev.some(t => t.id === trackId) ? prev : [{ id: trackId }, ...prev]));
    }

    const method = currentlyLiked ? 'DELETE' : 'POST';
    try {
      const url = `${BACKEND_URL}/likes/songs/${trackId}`;
      console.log('[likes] track toggle', { trackId, method, url });
      const resp = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json', ...buildPiHeaders(user) },
      });
      const json = await resp.json().catch(() => ({}));
      if (!resp.ok || json?.success !== true) {
        console.error('[likes] track toggle failed', { status: resp.status, json });
        setLikedTracks(previous);
        return;
      }
      console.log('[likes] track toggle success');
      await loadAllLikes();
    } catch (_e) {
      console.error('[likes] track toggle exception', _e);
      setLikedTracks(previous);
    }
  }, [user?.uid, likedTrackIds, likedTracks, BACKEND_URL, loadAllLikes]);

  const togglePlaylistLike = useCallback(async (playlistId: string) => {
    if (!user?.uid || !playlistId) return;
    const currentlyLiked = likedPlaylistIds.has(playlistId);

    const previous = likedPlaylists;
    if (currentlyLiked) {
      setLikedPlaylists(prev => prev.filter(p => p.id !== playlistId));
    } else {
      setLikedPlaylists(prev => (prev.some(p => p.id === playlistId) ? prev : [{ id: playlistId }, ...prev]));
    }

    const method = currentlyLiked ? 'DELETE' : 'POST';
    try {
      const url = `${BACKEND_URL}/likes/playlists/${playlistId}`;
      console.log('[likes] playlist toggle', { playlistId, method, url });
      const resp = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json', ...buildPiHeaders(user) },
      });
      const json = await resp.json().catch(() => ({}));
      if (!resp.ok || json?.success !== true) {
        console.error('[likes] playlist toggle failed', { status: resp.status, json });
        setLikedPlaylists(previous);
        return;
      }
      console.log('[likes] playlist toggle success');
      await loadAllLikes();
    } catch (_e) {
      console.error('[likes] playlist toggle exception', _e);
      setLikedPlaylists(previous);
    }
  }, [user?.uid, likedPlaylistIds, likedPlaylists, BACKEND_URL, loadAllLikes]);

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
