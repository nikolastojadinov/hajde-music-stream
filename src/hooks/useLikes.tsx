import { useState, useEffect, useCallback } from "react";
import { externalSupabase } from "@/lib/externalSupabase";
import { usePi } from "@/contexts/PiContext";

export interface LikedPlaylist {
  id: string;
  title: string;
  description: string | null;
  cover_url: string | null;
  image_url: string | null;
  category: string | null;
  created_at: string;
  owner_id: string | null;
}

export interface LikedTrack {
  id: string;
  title: string;
  artist: string;
  cover_url: string | null;
  image_url: string | null;
  external_id: string | null;
  youtube_id: string;
  duration: number | null;
}

export const useLikes = () => {
  const { user } = usePi();
  const [likedPlaylists, setLikedPlaylists] = useState<LikedPlaylist[]>([]);
  const [likedTracks, setLikedTracks] = useState<LikedTrack[]>([]);
  const [likedPlaylistIds, setLikedPlaylistIds] = useState<Set<string>>(new Set());
  const [likedTrackIds, setLikedTrackIds] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);

  const BACKEND_URL = import.meta.env.VITE_BACKEND_URL || "";

  // Load liked playlists (via backend to bypass RLS)
  const loadLikedPlaylists = useCallback(async () => {
    if (!user?.uid) {
      setLikedPlaylists([]);
      setLikedPlaylistIds(new Set());
      return;
    }

    try {
      const resp = await fetch(`${BACKEND_URL}/likes/playlists?user_id=${user.uid}`);
      if (!resp.ok) {
        const err = await resp.json().catch(() => ({}));
        console.error("❌ Error loading liked playlists:", err);
        return;
      }
      const json = await resp.json();
      const playlists = (json.items || []) as LikedPlaylist[];

      setLikedPlaylists(playlists);
      setLikedPlaylistIds(new Set(playlists.map((p: any) => p.id)));
    } catch (error) {
      console.error("❌ Exception loading liked playlists:", error);
    }
  }, [user?.uid]);

  // Load liked tracks (via backend to bypass RLS)
  const loadLikedTracks = useCallback(async () => {
    if (!user?.uid) {
      setLikedTracks([]);
      setLikedTrackIds(new Set());
      return;
    }

    try {
      const resp = await fetch(`${BACKEND_URL}/likes/tracks?user_id=${user.uid}`);
      if (!resp.ok) {
        const err = await resp.json().catch(() => ({}));
        console.error("❌ Error loading liked tracks:", err);
        return;
      }
      const json = await resp.json();
      const tracks = (json.items || []) as LikedTrack[];

      setLikedTracks(tracks);
      setLikedTrackIds(new Set(tracks.map((t: any) => t.id)));
    } catch (error) {
      console.error("❌ Exception loading liked tracks:", error);
    }
  }, [user?.uid]);

  // Load all likes (both playlists and tracks)
  const loadAllLikes = useCallback(async () => {
    if (!user?.uid) {
      setLikedPlaylists([]);
      setLikedPlaylistIds(new Set());
      setLikedTracks([]);
      setLikedTrackIds(new Set());
      return;
    }

    setLoading(true);
    await Promise.all([loadLikedPlaylists(), loadLikedTracks()]);
    setLoading(false);
  }, [user?.uid, loadLikedPlaylists, loadLikedTracks]);

  // Load playlists and tracks on mount and when user changes
  useEffect(() => {
    loadAllLikes();
  }, [user?.uid, loadAllLikes, refreshKey]);

  // Toggle playlist like (not supported by current schema -> warn)
  const togglePlaylistLike = useCallback(async (playlistId: string) => {
    if (!user?.uid) {
      console.warn("⚠️ User not logged in, cannot like playlist");
      return;
    }
    console.warn('⚠️ Playlist liking is not supported by current schema. Skipping.');
  }, [user?.uid, likedPlaylistIds]);

  // Toggle track like (via backend for RLS-safe write)
  const toggleTrackLike = useCallback(async (trackId: string) => {
    if (!user?.uid) {
      console.warn("⚠️ User not logged in, cannot like track");
      return;
    }

    const isCurrentlyLiked = likedTrackIds.has(trackId);

    try {
      if (isCurrentlyLiked) {
        const resp = await fetch(`${BACKEND_URL}/likes/track/${trackId}`, {
          method: 'DELETE',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ user_id: user.uid })
        });
        if (!resp.ok) {
          const err = await resp.json().catch(() => ({}));
          console.error("❌ Error unliking track:", err);
          return;
        }

        // Update local state immediately for responsive UI
        setLikedTrackIds(prev => {
          const newSet = new Set(prev);
          newSet.delete(trackId);
          return newSet;
        });
        setLikedTracks(prev => prev.filter(t => t.id !== trackId));
      } else {
        const resp = await fetch(`${BACKEND_URL}/likes/track/${trackId}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ user_id: user.uid })
        });
        if (!resp.ok) {
          const err = await resp.json().catch(() => ({}));
          console.error("❌ Error liking track:", err);
          return;
        }

        // Update local state - optimistic update for ID, then refresh for full data
        setLikedTrackIds(prev => new Set([...prev, trackId]));
        
        // Trigger a refresh to get full track data
        setRefreshKey(prev => prev + 1);
      }
    } catch (error) {
      console.error("❌ Exception toggling track like:", error);
    }
  }, [user?.uid, likedTrackIds]);

  // Check if playlist is liked
  const isPlaylistLiked = useCallback((playlistId: string) => {
    return likedPlaylistIds.has(playlistId);
  }, [likedPlaylistIds]);

  // Check if track is liked
  const isTrackLiked = useCallback((trackId: string) => {
    return likedTrackIds.has(trackId);
  }, [likedTrackIds]);

  return {
    likedPlaylists,
    likedTracks,
    likedPlaylistIds,
    likedTrackIds,
    loading,
    togglePlaylistLike,
    toggleTrackLike,
    isPlaylistLiked,
    isTrackLiked,
    loadLikedPlaylists,
    loadLikedTracks,
    loadAllLikes,
  };
};
