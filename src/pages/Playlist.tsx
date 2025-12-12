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
 * Clean + normalize playlist title for single-line display (Spotify-like)
 */
const formatPlaylistTitle = (raw: string): string => {
  if (!raw) return "";

  // Decode basic HTML entities
  const decoded = raw
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">");

  // Remove obvious noise words
  const cleaned = decoded
    .replace(/\bpodcast\b/gi, "")
    .replace(/\s+/g, " ")
    .trim();

  // Split on natural delimiters and keep the meaningful first part
  const parts = cleaned.split(/\s[-|•,]\s/);

  // Hard safety limit (never cut words)
  const main = parts[0];
  if (main.length <= 60) return main;

  const words = main.split(" ");
  let result = "";
  for (const w of words) {
    if ((result + " " + w).trim().length > 60) break;
    result = (result + " " + w).trim();
  }

  return result;
};

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
        if (statsKey && payload?.stats) mutate(statsKey, payload.stats, false);
        else if (statsKey) mutate(statsKey);
      })
      .catch((err) => {
        if (err?.name !== "AbortError") {
          console.warn("[playlist] Failed to register view", err);
        }
      });

    return () => controller.abort();
  }, [id, mutate, statsKey, user, viewUrl]);

  const handlePlayPlaylist = () => {
    if (!playlist?.tracks?.length) return;
    playPlaylist(
      playlist.tracks.map(t => ({
        id: t.id,
        external_id: t.external_id,
        title: t.title,
        artist: t.artist,
      })),
      0
    );
    setCurrentTrackId(playlist.tracks[0].id);
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
      <div className="flex-1 flex items-center justify-center">
        <p className="text-muted-foreground">{t("playlist_load_error")}</p>
      </div>
    );
  }

  const displayTitle = formatPlaylistTitle(playlist.title);

  return (
    <div className="flex-1 overflow-y-auto pb-32">
      <div className="relative bg-gradient-to-b from-purple-900/40 to-background p-4 md:p-8">
        <div className="flex gap-4 items-end">
          <div className="w-40 h-40 rounded-lg overflow-hidden">
            <img
              src={playlist.cover_url || "/placeholder.svg"}
              alt={displayTitle}
              className="w-full h-full object-cover"
            />
          </div>
          <div>
            <h1 className="text-3xl md:text-5xl font-black truncate">
              {displayTitle}
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
            onClick={() => togglePlaylistLike(id!)}
            className="w-12 h-12 rounded-full bg-secondary flex items-center justify-center"
          >
            <Heart className={isLiked ? "fill-primary text-primary" : ""} />
          </button>

          {id && <PlaylistHeaderStats playlistId={id} />}
        </div>

        <div className="space-y-2">
          {playlist.tracks.map((track, index) => {
            const isCurrent = currentTrackId === track.id;
            return (
              <div
                key={track.id}
                onClick={() => {
                  playPlaylist(
                    playlist.tracks.map(t => ({
                      id: t.id,
                      external_id: t.external_id,
                      title: t.title,
                      artist: t.artist,
                    })),
                    index
                  );
                  setCurrentTrackId(track.id);
                }}
                className={`group flex items-center gap-3 p-2 rounded-lg cursor-pointer hover:bg-white/5 ${
                  isCurrent ? "bg-white/10" : ""
                }`}
              >
                <img
                  src={track.cover_url || playlist.cover_url || "/placeholder.svg"}
                  className="w-12 h-12 rounded object-cover"
                />
                <div className="flex-1 truncate">
                  <div className="font-medium truncate">{track.title}</div>
                  <div className="text-sm text-muted-foreground truncate">
                    {track.artist}
                  </div>
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
