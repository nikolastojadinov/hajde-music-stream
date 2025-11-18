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
 * - Učitava inicijalno stanje iz Supabase `playlist_likes`
 * - Like/Unlike ide preko backend API-ja: POST/DELETE /likes/playlist
 */
export function usePlaylistLike(playlistId: string | null | undefined): UsePlaylistLikeReturn {
  const { user } = usePi();
  const [liked, setLiked] = useState<boolean>(false);
  const [loading, setLoading] = useState<boolean>(false);
  const BACKEND_URL = useMemo(() => import.meta.env.VITE_BACKEND_URL || "", []);

  // Učitaj inicijalno stanje iz Supabase (playlist_likes)
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
          console.warn("[usePlaylistLike] select error:", error.message);
          setLiked(false);
        } else {
          setLiked(Boolean(data && data.length > 0));
        }
      } catch (e) {
        console.warn("[usePlaylistLike] select exception:", e);
        setLiked(false);
      } finally {
        setLoading(false);
      }
    };
    load();
  }, [user?.uid, playlistId]);

  const toggleLike = useCallback(async () => {
    if (!user?.uid || !playlistId) return;

    // Optimistički update
    const next = !liked;
    setLiked(next);

    try {
      const resp = await fetch(`${BACKEND_URL}/likes/playlist`, {
        method: next ? "POST" : "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ user_id: user.uid, playlist_id: playlistId }),
      });

      if (!resp.ok) {
        const err = await resp.json().catch(() => ({}));
        console.error("[usePlaylistLike] toggle error:", err);
        // Revert on failure
        setLiked(!next);
      } else {
        const json = await resp.json().catch(() => ({}));
        if (json?.success !== true) {
          console.error("[usePlaylistLike] toggle failed:", json);
          setLiked(!next);
        }
      }
    } catch (e) {
      console.error("[usePlaylistLike] toggle exception:", e);
      setLiked(!next);
    }
  }, [BACKEND_URL, liked, playlistId, user?.uid]);

  return { liked, toggleLike, loading };
}

export default usePlaylistLike;
