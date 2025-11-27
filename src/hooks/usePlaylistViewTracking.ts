import { useMutation, useQueryClient } from "@tanstack/react-query";
import { usePi } from "@/contexts/PiContext";
import { useCallback, useEffect, useRef } from "react";

const BACKEND_URL = import.meta.env.VITE_BACKEND_URL || "http://localhost:3001";
const TRACKING_ENABLED = (import.meta.env.VITE_ENABLE_PLAYLIST_TRACKING ?? "true") !== "false";

export const usePlaylistViewTracking = () => {
  const { user } = usePi();
  const queryClient = useQueryClient();
  const lastTrackedPlaylistId = useRef<string | null>(null);

  const trackViewMutation = useMutation({
    mutationFn: async (playlistId: string) => {
      if (!TRACKING_ENABLED) {
        return null;
      }

      if (!user?.uid) {
        console.log("[PlaylistViewTracking] No user logged in, skipping tracking");
        return null;
      }

      const response = await fetch(`${BACKEND_URL}/api/playlist-views/track`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          user_id: user.uid,
          playlist_id: playlistId,
        }),
      });

      if (!response.ok) {
        throw new Error("Failed to track playlist view");
      }

      return response.json();
    },
    onSuccess: () => {
      // Invalidate recent playlists query to refresh the grid when tracking runs
      queryClient.invalidateQueries({ queryKey: ["recent-playlists", user?.uid] });
    },
    onError: (error) => {
      console.error("[PlaylistViewTracking] Error:", error);
    },
  });

  const trackView = useCallback(
    (playlistId: string) => {
      if (!TRACKING_ENABLED || !playlistId || !user?.uid) {
        return;
      }

      if (lastTrackedPlaylistId.current === playlistId) {
        return;
      }

      lastTrackedPlaylistId.current = playlistId;
      trackViewMutation.mutate(playlistId);
    },
    [trackViewMutation, user?.uid]
  );

  useEffect(() => {
    lastTrackedPlaylistId.current = null;
  }, [user?.uid]);

  return {
    trackView,
    isTracking: trackViewMutation.isPending,
  };
};
