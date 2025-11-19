import { useCallback, useEffect, useMemo, useState } from "react";
import { usePi } from "@/contexts/PiContext";
import { externalSupabase } from "@/lib/externalSupabase";

type UsePlaylistLikeReturn = {
  liked: boolean;
  toggleLike: () => Promise<void>;
  loading: boolean;
};

/**
 * usePlaylistLike
 * - Loads initial like state from Supabase `playlist_likes`
 * - Like/Unlike goes through backend API:
 *   POST   /likes/playlists/:id
 *   DELETE /likes/playlists/:id
 */
export function usePlaylistLike(
  playlistId: string | null | undefined
): UsePlaylistLikeReturn {
  const { user } = usePi();
  const [liked, setLiked] = useState<boolean>(false);
  const [loading, setLoading] = useState<boolean>(false);
  const BACKEND_URL = useMemo(
    () => import.meta.env.VITE_BACKEND_URL || "",
    []
  );

  // Load initial like state from Supabase
  useEffect(() => {
    const load = async () => {
      if (!user?.uid || !playlistId) {
        setLiked(false);
        return;
      }
      setLoading(true);

      try {
        const { data, error } = await externalSupabase
          .from("playlist_likes")
          .select("user_id, playlist_id")
          .eq("user_id", user.uid)
          .eq("playlist_id", playlistId)
          .limit(1);

        if (error) {
          console.warn("[usePlaylistLike] Supabase select error:", error.message);
          setLiked(false);
        } else {
          setLiked(Boolean(data && data.length > 0));
        }
      } catch (e) {
        console.warn("[usePlaylistLike] Supabase exception:", e);
        setLiked(false);
      } finally {
        setLoading(false);
      }
    };

    load();
  }, [user?.uid, playlistId]);

  const toggleLike = useCallback(async () => {
    if (!user?.uid || !playlistId) return;

    const next = !liked;
    setLiked(next); // optimistic update

    try {
      const method = next ? "POST" : "DELETE";
      const resp = await fetch(`${BACKEND_URL}/likes/playlists/${playlistId}`, {
        method,
        headers: { "Content-Type": "application/json" },
        body: method === "POST"
          ? JSON.stringify({ user_id: user.uid })
          : JSON.stringify({ user_id: user.uid }),
      });

      if (!resp.ok) {
        const err = await resp.json().catch(() => ({}));
        console.error("[usePlaylistLike] toggle error:", err);
        setLiked(!next);
        return;
      }

      const json = await resp.json().catch(() => ({}));
      if (json?.success !== true) {
        console.error("[usePlaylistLike] toggle failed:", json);
        setLiked(!next);
      }
    } catch (e) {
      console.error("[usePlaylistLike] toggle exception:", e);
      setLiked(!next);
    }
  }, [BACKEND_URL, liked, playlistId, user?.uid]);

  return { liked, toggleLike, loading };
}

export default usePlaylistLike;
