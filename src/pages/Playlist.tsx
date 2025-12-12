import { useEffect, useMemo, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import { Play, Pause, Heart } from "lucide-react";
import { Button } from "@/components/ui/button";
import { usePlayer } from "@/contexts/PlayerContext";
import { Skeleton } from "@/components/ui/skeleton";
import { useExternalPlaylist } from "@/hooks/useExternalPlaylist";
import useLikes from "@/hooks/useLikes";
import { useLanguage } from "@/contexts/LanguageContext";
import { usePi } from "@/contexts/PiContext";
import { PlaylistHeaderStats } from "@/components/playlists/PlaylistHeaderStats";
import { useSWRConfig } from "swr";
import { withBackendOrigin } from "@/lib/backendUrl";
import { usePlaylistViewTracking } from "@/hooks/usePlaylistViewTracking";
import AddToPlaylistButton from "@/components/AddToPlaylistButton";

/**
 * ✅ Normalizuje YouTube / HTML playlist naslove
 * - dekodira &amp; &nbsp; itd
 * - seče pre | , – —
 * - trimuje višak
 */
function normalizePlaylistTitle(title: string) {
  if (!title) return "";

  // Decode HTML entities
  const textarea = document.createElement("textarea");
  textarea.innerHTML = title;
  const decoded = textarea.value;

  // Cut long YouTube-style titles
  return decoded
    .split(/[\|–—,]/)[0]
    .replace(/\s+/g, " ")
    .trim();
}

const Playlist = () => {
  const { id } = useParams<{ id: string }>();
  const { playPlaylist, isPlaying, togglePlay } = usePlayer();
  const { isPlaylistLiked, togglePlaylistLike } = useLikes();
  const { t } = useLanguage();
  const [currentTrackId, setCurrentTrackId] = useState<string | null>(null);
  const { mutate } = useSWRConfig();
  const { user } = usePi();
  const lastLoggedViewId = useRef<string | null>(null);
  const { trackView } = usePlaylistViewTracking();

  const { data: playlist, isLoading, error } = useExternalPlaylist(id || "");
  const isLiked = id ? isPlaylistLiked(id) : false;

  const statsKey = useMemo(
    () => (id ? withBackendOrigin(`/api/playlists/${id}/public-stats`) : null),
    [id]
  );

  const viewUrl = useMemo(
    () => (id ? withBackendOrigin(`/api/playlists/${id}/public-view`) : null),
    [id]
  );

  // Track playlist view
  useEffect(() => {
    if (id && user?.uid) {
      trackView(id);
    }
  }, [id, user?.uid, trackView]);

  useEffect(() => {
    if (!id || !user?.uid || lastLoggedViewId.current === id || !viewUrl || !statsKey) {
      return;
    }

    lastLoggedViewId.current = id;
    const controller = new AbortController();

    fetch(viewUrl, {
      method: "POST",
      credentials: "include",
      headers: {
        "X-Pi-User-Id": user.uid,
        "X-Pi-Username": user.username ?? "",
        "X-Pi-Premium": user.premium ? "true" : "false",
        "X-Pi-Premium-Until": user.premium_until ?? "",
      },
      signal: controller.signal,
    })
      .then(async (resp) => {
        if (!resp.ok) throw new Error(`view_log_failed_${resp.status}`);
        const payload = await resp.json().catch(() => null);
        if (statsKey && payload?.stats) {
          mutate(statsKey, payload.stats, false);
        } else if (statsKey) {
          mutate(statsKey);
        }
      })
      .catch((err: any) => {
        if (err?.name !== "AbortError") {
          console.warn("[playlist] Failed to register public view", err);
        }
      });

    return () => controller.abort();
  }, [
    id,
    mutate,
    statsKey,
    user?.premium,
    user?.premium_until,
    user?.uid,
    user?.username,
    viewUrl,
  ]);

  const formatDuration = (seconds: number | null) => {
    if (!seconds) return "0:00";
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, "0")}`;
  };

  const handlePlayPlaylist = () => {
    if (!playlist || playlist.tracks.length === 0) return;
    playPlaylist(
      playlist.tracks.map((t) => ({
        id: t.id,
        external_id: t.external_id,
        title: t.title,
        artist: t.artist,
      })),
      0
    );
    setCurrentTrackId(playlist.tracks[0].id);
  };

  const handlePlayTrack = (track: any, index: number) => {
    if (!playlist) return;
    playPlaylist(
      playlist.tracks.map((t) => ({
        id: t.id,
        external_id: t.external_id,
        title: t.title,
        artist: t.artist,
      })),
      index
    );
    setCurrentTrackId(track.id);
  };

  const handleToggleLike = async () => {
    if (!id) return;
    try {
      await togglePlaylistLike(id);
    } finally {
      if (statsKey) mutate(statsKey);
    }
  };

  if (isLoading) {
    return (
      <div className="flex-1 overflow-y-auto pb-32">
        <div className="relative h-80 bg-gradient-to-b from-purple-900/40 to-background p-8">
          <Skeleton className="w-56 h-56 rounded-lg" />
        </div>
      </div>
    );
  }

  if (error || !playlist) {
    return (
      <div className="flex-1 overflow-y-auto pb-32 flex items-center justify-center">
        <div className="text-center p-4">
          <h2 className="text-2xl font-bold mb-2">
            {t("playlist_not_found")}
          </h2>
          <Button onClick={() => window.history.back()}>
            {t("back")}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto pb-32">
      <div className="relative bg-gradient-to-b from-purple-900/40 to-background p-4 md:p-8">
        <div className="flex flex-col md:flex-row md:items-end gap-4">
          <div className="w-40 h-40 md:w-48 md:h-48 rounded-lg overflow-hidden">
            <img
              src={playlist.cover_url || "/placeholder.svg"}
              alt={playlist.title}
              className="w-full h-full object-cover"
            />
          </div>
          <div>
            <h1 className="text-3xl md:text-5xl font-black">
              {normalizePlaylistTitle(playlist.title)}
            </h1>
            <p className="text-sm text-muted-foreground mt-2">
              {playlist.tracks.length} {t("songs")}
            </p>
          </div>
        </div>
      </div>

      <div className="p-4 md:p-8">
        <div className="flex items-center gap-4 mb-6">
          <Button size="lg" className="rounded-full" onClick={handlePlayPlaylist}>
            <Play className="w-5 h-5 mr-2 fill-current" />
            {t("play_all")}
          </Button>

          <button
            onClick={handleToggleLike}
            className="w-12 h-12 rounded-full bg-secondary hover:bg-secondary/80 flex items-center justify-center"
          >
            <Heart
              className={`w-6 h-6 ${
                isLiked ? "fill-primary text-primary" : "text-muted-foreground"
              }`}
            />
          </button>

          {id && <PlaylistHeaderStats playlistId={id} />}
        </div>

        <div className="space-y-2">
          {playlist.tracks.map((track, index) => {
            const isCurrent = currentTrackId === track.id;
            return (
              <div
                key={track.id}
                className={`flex items-center gap-3 p-2 rounded-lg cursor-pointer ${
                  isCurrent ? "bg-white/10" : "hover:bg-white/5"
                }`}
                onClick={() => handlePlayTrack(track, index)}
              >
                <div className="flex-1 min-w-0">
                  <div className="font-medium truncate">{track.title}</div>
                  <div className="text-sm text-muted-foreground truncate">
                    {track.artist}
                  </div>
                </div>
                <div className="text-sm text-muted-foreground">
                  {formatDuration(track.duration)}
                </div>
                <AddToPlaylistButton trackId={track.id} trackTitle={track.title} />
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};

export default Playlist;
