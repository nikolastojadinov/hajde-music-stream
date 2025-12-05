import { fetchWithPiAuth } from "@/lib/fetcher";

export type AddTrackToPlaylistResponse = {
  success: boolean;
  already_exists?: boolean;
  playlist_id?: string;
  track_id?: string;
  position?: number;
  added_at?: string | null;
};

export async function addTrackToPlaylist(playlistId: string, trackId: string) {
  const response = await fetchWithPiAuth(`/api/studio/playlists/${playlistId}/tracks`, {
    method: "POST",
    body: JSON.stringify({ track_id: trackId }),
  });

  let payload: AddTrackToPlaylistResponse | { error?: string } | null = null;
  try {
    payload = (await response.json()) as AddTrackToPlaylistResponse | { error?: string } | null;
  } catch (_) {
    payload = null;
  }

  if (!response.ok || !payload || (payload as AddTrackToPlaylistResponse).success !== true) {
    const message = (payload as { error?: string } | null)?.error || "Unable to add track to playlist.";
    throw new Error(message);
  }

  return payload as AddTrackToPlaylistResponse;
}
