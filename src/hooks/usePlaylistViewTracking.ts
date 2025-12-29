import { useMutation, useQueryClient } from "@tanstack/react-query";
import { usePi } from "@/contexts/PiContext";
import { useCallback, useEffect } from "react";
import { dedupeEvent } from "@/lib/requestDeduper";
import { withBackendOrigin } from "@/lib/backendUrl";

const TRACKING_ENABLED = (import.meta.env.VITE_ENABLE_PLAYLIST_TRACKING ?? "true") !== "false";
const trackedPlaylistsSession = new Set<string>();

export const usePlaylistViewTracking = () => {
  const { user } = usePi();
  const queryClient = useQueryClient();

  const trackViewMutation = useMutation({
    mutationFn: async (playlistId: string) => {
      if (!TRACKING_ENABLED) {
        return null;
      }

      if (!user?.uid) {
        console.log("[PlaylistViewTracking] No user logged in, skipping tracking");
        return null;
      }

      const trackUrl = withBackendOrigin(`/api/playlist-views/track`);

      const response = await fetch(trackUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        credentials: "include",
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

      const sessionKey = `${user.uid}:${playlistId}`;
      if (trackedPlaylistsSession.has(sessionKey)) {
        return;
      }

      trackedPlaylistsSession.add(sessionKey);
      const eventPromise = dedupeEvent(
        `POST:track-view:${sessionKey}`,
        5000,
        async () => trackViewMutation.mutateAsync(playlistId)
      );

      if (eventPromise) {
        eventPromise.catch(() => {
          /* handled by mutation onError */
        });
      }
    },
    [trackViewMutation, user?.uid]
  );

  useEffect(() => {
    trackedPlaylistsSession.clear();
  }, [user?.uid]);

  return {
    trackView,
    isTracking: trackViewMutation.isPending,
  };
};
