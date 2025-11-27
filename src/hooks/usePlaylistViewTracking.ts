import { useMutation, useQueryClient } from "@tanstack/react-query";
import { usePi } from "@/contexts/PiContext";

const BACKEND_URL = import.meta.env.VITE_BACKEND_URL || "http://localhost:3001";
const TRACKING_ENABLED = false;

export const usePlaylistViewTracking = () => {
  const { user } = usePi();
  const queryClient = useQueryClient();

  const trackView = useMutation({
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
      // Invalidate recent playlists query to refresh the grid
      queryClient.invalidateQueries({ queryKey: ["recent-playlists"] });
    },
    onError: (error) => {
      console.error("[PlaylistViewTracking] Error:", error);
    },
  });

  return {
    trackView: (playlistId: string) => trackView.mutate(playlistId),
    isTracking: trackView.isPending,
  };
};
