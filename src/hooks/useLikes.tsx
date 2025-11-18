import { useState, useEffect, useCallback } from "react";
import { externalSupabase } from "@/lib/externalSupabase";
import { usePiLogin } from "./usePiLogin";

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
  const { user } = usePiLogin();
  const [likedPlaylists, setLikedPlaylists] = useState<LikedPlaylist[]>([]);
  const [likedTracks, setLikedTracks] = useState<LikedTrack[]>([]);
  const [likedPlaylistIds, setLikedPlaylistIds] = useState<Set<string>>(new Set());
  const [likedTrackIds, setLikedTrackIds] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(false);

  // Load liked playlists
  const loadLikedPlaylists = useCallback(async () => {
    if (!user?.uid) {
      setLikedPlaylists([]);
      setLikedPlaylistIds(new Set());
      return;
    }

    try {
      setLoading(true);
      const { data, error } = await externalSupabase
        .from("likes")
        .select(`
          playlist_id,
          playlists (
            id,
            title,
            description,
            cover_url,
            image_url,
            category,
            created_at,
            owner_id
          )
        `)
        .eq("user_id", user.uid)
        .not("playlist_id", "is", null);

      if (error) {
        console.error("❌ Error loading liked playlists:", error);
        return;
      }

      const playlists = (data || [])
        .filter((item: any) => item.playlists)
        .map((item: any) => item.playlists as unknown as LikedPlaylist);

      setLikedPlaylists(playlists);
      setLikedPlaylistIds(new Set(playlists.map((p: any) => p.id)));
      console.log("✅ Loaded liked playlists:", playlists.length);
    } catch (error) {
      console.error("❌ Exception loading liked playlists:", error);
    } finally {
      setLoading(false);
    }
  }, [user?.uid]);

  // Load liked tracks
  const loadLikedTracks = useCallback(async () => {
    if (!user?.uid) {
      setLikedTracks([]);
      setLikedTrackIds(new Set());
      return;
    }

    try {
      setLoading(true);
      const { data, error } = await externalSupabase
        .from("likes")
        .select(`
          track_id,
          tracks (
            id,
            title,
            artist,
            cover_url,
            image_url,
            external_id,
            youtube_id,
            duration
          )
        `)
        .eq("user_id", user.uid)
        .not("track_id", "is", null);

      if (error) {
        console.error("❌ Error loading liked tracks:", error);
        return;
      }

      const tracks = (data || [])
        .filter((item: any) => item.tracks)
        .map((item: any) => item.tracks as unknown as LikedTrack);

      setLikedTracks(tracks);
      setLikedTrackIds(new Set(tracks.map((t: any) => t.id)));
      console.log("✅ Loaded liked tracks:", tracks.length);
    } catch (error) {
      console.error("❌ Exception loading liked tracks:", error);
    } finally {
      setLoading(false);
    }
  }, [user?.uid]);

  // Load playlists on mount and when user changes
  useEffect(() => {
    if (!user?.uid) {
      setLikedPlaylists([]);
      setLikedPlaylistIds(new Set());
      return;
    }

    loadLikedPlaylists();
  }, [user?.uid, loadLikedPlaylists]);

  // Load tracks on mount and when user changes
  useEffect(() => {
    if (!user?.uid) {
      setLikedTracks([]);
      setLikedTrackIds(new Set());
      return;
    }

    loadLikedTracks();
  }, [user?.uid, loadLikedTracks]);

  // Toggle playlist like
  const togglePlaylistLike = useCallback(async (playlistId: string) => {
    if (!user?.uid) {
      console.warn("⚠️ User not logged in, cannot like playlist");
      return;
    }

    const isCurrentlyLiked = likedPlaylistIds.has(playlistId);
    console.log(`${isCurrentlyLiked ? "❌ Unliking" : "❤️ Liking"} playlist:`, playlistId);

    try {
      if (isCurrentlyLiked) {
        // Unlike: remove from database
        const { error } = await externalSupabase
          .from("likes")
          .delete()
          .eq("user_id", user.uid)
          .eq("playlist_id", playlistId);

        if (error) {
          console.error("❌ Error unliking playlist:", error);
          return;
        }

        // Update local state
        setLikedPlaylistIds(prev => {
          const newSet = new Set(prev);
          newSet.delete(playlistId);
          return newSet;
        });
        setLikedPlaylists(prev => prev.filter(p => p.id !== playlistId));
        console.log("✅ Playlist unliked");
      } else {
        // Like: add to database
        const { error } = await externalSupabase
          .from("likes")
          .insert({
            user_id: user.uid,
            playlist_id: playlistId,
          });

        if (error) {
          console.error("❌ Error liking playlist:", error);
          return;
        }

        // Update local state and reload to get full playlist data
        setLikedPlaylistIds(prev => new Set([...prev, playlistId]));
        await loadLikedPlaylists();
        console.log("✅ Playlist liked");
      }
    } catch (error) {
      console.error("❌ Exception toggling playlist like:", error);
    }
  }, [user?.uid, likedPlaylistIds, loadLikedPlaylists]);

  // Toggle track like
  const toggleTrackLike = useCallback(async (trackId: string) => {
    if (!user?.uid) {
      console.warn("⚠️ User not logged in, cannot like track");
      return;
    }

    const isCurrentlyLiked = likedTrackIds.has(trackId);
    console.log(`${isCurrentlyLiked ? "❌ Unliking" : "❤️ Liking"} track:`, trackId);

    try {
      if (isCurrentlyLiked) {
        // Unlike: remove from database
        const { error } = await externalSupabase
          .from("likes")
          .delete()
          .eq("user_id", user.uid)
          .eq("track_id", trackId);

        if (error) {
          console.error("❌ Error unliking track:", error);
          return;
        }

        // Update local state
        setLikedTrackIds(prev => {
          const newSet = new Set(prev);
          newSet.delete(trackId);
          return newSet;
        });
        setLikedTracks(prev => prev.filter(t => t.id !== trackId));
        console.log("✅ Track unliked");
      } else {
        // Like: add to database
        const { error } = await externalSupabase
          .from("likes")
          .insert({
            user_id: user.uid,
            track_id: trackId,
          });

        if (error) {
          console.error("❌ Error liking track:", error);
          return;
        }

        // Update local state and reload to get full track data
        setLikedTrackIds(prev => new Set([...prev, trackId]));
        await loadLikedTracks();
        console.log("✅ Track liked");
      }
    } catch (error) {
      console.error("❌ Exception toggling track like:", error);
    }
  }, [user?.uid, likedTrackIds, loadLikedTracks]);

  // Check if playlist is liked
  const isPlaylistLiked = useCallback((playlistId: string) => {
    return likedPlaylistIds.has(playlistId);
  }, [likedPlaylistIds]);

  // Check if track is liked
  const isTrackLiked = useCallback((trackId: string) => {
    return likedTrackIds.has(trackId);
  }, [likedTrackIds]);

  // Refresh likes when user changes
  useEffect(() => {
    if (user?.uid) {
      loadLikedPlaylists();
      loadLikedTracks();
    }
  }, [user?.uid, loadLikedPlaylists, loadLikedTracks]);

  return {
    likedPlaylists,
    likedTracks,
    loading,
    togglePlaylistLike,
    toggleTrackLike,
    isPlaylistLiked,
    isTrackLiked,
    loadLikedPlaylists,
    loadLikedTracks,
  };
};
