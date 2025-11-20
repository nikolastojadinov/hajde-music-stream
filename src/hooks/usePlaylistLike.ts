import { useCallback, useEffect, useMemo, useState } from "react";
import { usePi } from "@/contexts/PiContext";

type UsePlaylistLikeReturn = {
  liked: boolean;
  toggleLike: () => Promise<void>;
  loading: boolean;
};

function buildPiHeaders(u: { uid: string; username?: string; premium?: boolean; premium_until?: string | null } | null) {
  const uid = u?.uid || "";
  const username = u?.username || "";
  const premium = String(u?.premium === true);
  const premiumUntil = u?.premium_until || "";
  return {
    "X-Pi-User-Id": uid,
    "X-Pi-Username": username,
    "X-Pi-Premium": premium,
    "X-Pi-Premium-Until": premiumUntil,
  } as Record<string, string>;
}

/**
 * usePlaylistLike (backend-only)
 * - No direct Supabase access to restricted tables.
 * - Initial state via backend GET /likes/playlists
 * - Toggle via backend POST/DELETE /likes/playlists/:id
 */
export function usePlaylistLike(playlistId: string | null | undefined): UsePlaylistLikeReturn {
  const { user } = usePi();
  const [liked, setLiked] = useState<boolean>(false);
  const [loading, setLoading] = useState<boolean>(false);
  const BACKEND_URL = useMemo(() => import.meta.env.VITE_BACKEND_URL || "", []);

  useEffect(() => {
    const load = async () => {
      if (!user?.uid || !playlistId) {
        setLiked(false);
        return;
      }
      setLoading(true);
      try {
        const resp = await fetch(`${BACKEND_URL}/likes/playlists`, {
          method: "GET",
          headers: {
            "Content-Type": "application/json",
            ...buildPiHeaders(user),
          },
        });
        if (!resp.ok) {
          setLiked(false);
          return;
        }
        const json = await resp.json();
        const items: Array<{ id: string }> = Array.isArray(json?.items) ? json.items : [];
        setLiked(items.some((p) => String(p.id) === String(playlistId)));
      } catch (_e) {
        setLiked(false);
      } finally {
        setLoading(false);
      }
    };
    load();
  }, [BACKEND_URL, playlistId, user?.uid]);

  const toggleLike = useCallback(async () => {
    if (!user?.uid || !playlistId) return;
    const next = !liked;
    setLiked(next);
    try {
      const method = next ? "POST" : "DELETE";
      const resp = await fetch(`${BACKEND_URL}/likes/playlists/${playlistId}`, {
        method,
        headers: {
          "Content-Type": "application/json",
          ...buildPiHeaders(user),
        },
      });
      if (!resp.ok) {
        setLiked(!next);
        return;
      }
      const json = await resp.json().catch(() => ({}));
      if (json?.success !== true) {
        setLiked(!next);
      }
    } catch (_e) {
      setLiked(!next);
    }
  }, [BACKEND_URL, liked, playlistId, user]);

  return { liked, toggleLike, loading };
}

export default usePlaylistLike;
 

