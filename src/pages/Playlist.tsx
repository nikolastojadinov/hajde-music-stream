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
 * User-facing playlist title normalization
 * (backend title stays untouched)
 */
const normalizePlaylistTitle = (title: string): string => {
  if (!title) return "";

  let t = title;

  // Decode common HTML entities
  t = t
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, "")
    .replace(/&#39;/gi, "'");

  // Remove text in brackets
  t = t.replace(/\([^)]*\)/g, "");

  // Remove common noise words
  t = t.replace(
    /\b(podcast|radio|live|mixes|dj set|episode|full album)\b/gi,
    ""
  );

  // Remove emojis
  t = t.replace(
    /[\u{1F300}-\u{1FAFF}]/gu,
    ""
  );

  // Normalize separators
  t = t.replace(/\s{2,}/g, " ");
  t = t.replace(/\s*[-–—]\s*/g, " - ");

  // Trim and limit length
  t = t.trim();
  if (t.length > 70) {
    t = t.slice(0, 67).trim() + "…";
  }

  return t;
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

  const displayTitle = useMemo(
    () => normalizePlaylistTitle(playlist?.title ?? ""),
    [playlist?.title]
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
        if (payload?.stats) mutate(statsKey!, payload.stats, false);
        else mutate(statsKey!);
      })
      .catch((err) => {
        if (err?.name !== "AbortError") {
          console.warn("[playlist] view log failed", err);
        }
      });

    return () => controller.abort();
  }, [id, mutate, statsKey, user, viewUrl]);

  const formatDuration = (seconds: number | null) => {
    if (!seconds) return "0:00";
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m}:${s.toString().padStart(2, "0")}`;
  };

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
      <div className="flex-1 overflow-y-auto pb-32 flex items-center justify-center">
        <div className="text-center">
          <h2 className="text-xl font-bold">{t("playlist_load_error")}</h2>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto pb-32">
      <div className="bg-gradient-to-b from-purple-900/40 to-background p-6">
        <div className="flex gap-4 items-end">
          <img
            src={playlist.cover_url || "/placeholder.svg"}
            className="w-40 h-40 rounded-lg object-cover"
          />
          <div>
            <h1 className="text-3xl md:text-5xl font-black">
              {displayTitle}
            </h1>
            <p className="text-sm text-muted-foreground">
              {playlist.tracks.length} {t("songs")}
            </p>
          </div>
        </div>
      </div>

      <div className="p-6">
        <Button size="lg" className="rounded-full mb-6" onClick={handlePlayPlaylist}>
          <Play className="w-5 h-5 mr-2 fill-current" />
          {t("play_all")}
        </Button>

        <div className="space-y-2">
          {playlist.tracks.map((track, index) => (
            <div
              key={track.id}
              className="flex items-center gap-3 p-2 rounded-lg hover:bg-white/5"
              onClick={() => handlePlayPlaylist()}
            >
              <div className="flex-1 truncate">
                <div className="font-medium truncate">{track.title}</div>
                <div className="text-sm text-muted-foreground truncate">
                  {track.artist}
                </div>
              </div>
              <div className="text-sm text-muted-foreground">
                {formatDuration(track.duration)}
              </div>
              <AddToPlaylistButton
                trackId={track.id}
                trackTitle={track.title}
                variant="ghost"
              />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

export default Playlist;
