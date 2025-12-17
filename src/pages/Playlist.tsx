import { useEffect, useMemo, useRef, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { Play, Pause, Heart, ArrowLeft } from "lucide-react";
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
  const navigate = useNavigate();

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
    if (!id || !user?.uid || lastLoggedViewId.current === id || !viewUrl) return;
    lastLoggedViewId.current = id;

    fetch(viewUrl, {
      method: "POST",
      credentials: "include",
      headers: {
        "X-Pi-User-Id": user.uid,
        "X-Pi-Username": user.username ?? "",
        "X-Pi-Premium": user.premium ? "true" : "false",
        "X-Pi-Premium-Until": user.premium_until ?? "",
      },
    }).then(() => {
      if (statsKey) mutate(statsKey);
    });
  }, [id, user, viewUrl, statsKey, mutate]);

  const handlePlayPlaylist = () => {
    if (!playlist || playlist.tracks.length === 0) return;
    const trackData = playlist.tracks.map((t) => ({
      id: t.id,
      external_id: t.external_id,
      title: t.title,
      artist: t.artist,
    }));
    playPlaylist(trackData, 0);
    setCurrentTrackId(playlist.tracks[0].id);
  };

  const handlePlayTrack = (track: any, index: number) => {
    if (!playlist) return;
    const trackData = playlist.tracks.map((t) => ({
      id: t.id,
      external_id: t.external_id,
      title: t.title,
      artist: t.artist,
    }));
    playPlaylist(trackData, index);
    setCurrentTrackId(track.id);
  };

  const handleToggleLike = async () => {
    if (!id) return;
    await togglePlaylistLike(id);
    if (statsKey) mutate(statsKey);
  };

  const handleBack = () => {
    const idx = (window.history.state as { idx?: number } | null)?.idx;
    if (typeof idx === "number" && idx > 0) navigate(-1);
    else navigate("/search");
  };

  if (isLoading) {
    return (
      <div className="flex-1 overflow-y-auto pb-32 flex justify-center pt-20">
        <Skeleton className="w-48 h-48 rounded-xl" />
      </div>
    );
  }

  if (error || !playlist) {
    return null;
  }

  return (
    <div className="relative flex-1 overflow-y-auto pb-32">
      {/* ===== HEADER ===== */}
      <div className="pt-6 px-4 text-center">
        <div className="flex justify-center mb-4">
          <img
            src={playlist.cover_url || "/placeholder.svg"}
            alt={playlist.title}
            className="w-48 h-48 rounded-xl object-cover"
          />
        </div>

        <h1
          className="font-black text-[26px] leading-tight line-clamp-2"
          style={{
            fontSize:
              playlist.title.length > 60
                ? "22px"
                : playlist.title.length > 40
                ? "24px"
                : "26px",
          }}
        >
          {playlist.title}
        </h1>

        <p className="text-sm text-muted-foreground mt-1">
          {playlist.tracks.length} {t("songs")}
        </p>

        <div className="flex justify-center items-center gap-4 mt-5">
          <Button size="lg" className="rounded-full" onClick={handlePlayPlaylist}>
            <Play className="w-5 h-5 mr-2 fill-current" />
            {t("play_all")}
          </Button>

          <button
            onClick={handleToggleLike}
            className="w-12 h-12 rounded-full bg-secondary flex items-center justify-center"
          >
            <Heart
              className={`w-6 h-6 ${
                isLiked ? "fill-primary text-primary" : "text-muted-foreground"
              }`}
            />
          </button>

          {id && <PlaylistHeaderStats playlistId={id} />}
        </div>
      </div>

      {/* ===== TRACK LIST ===== */}
      <div className="px-4 mt-8 space-y-2">
        {playlist.tracks.map((track, index) => {
          const isCurrent = currentTrackId === track.id;
          return (
            <div
              key={track.id}
              onClick={() => handlePlayTrack(track, index)}
              className={`flex items-center gap-3 p-2 rounded-lg cursor-pointer hover:bg-white/5 ${
                isCurrent ? "bg-white/10" : ""
              }`}
            >
              <div className="w-12 h-12 rounded overflow-hidden bg-card relative">
                <img
                  src={track.cover_url || playlist.cover_url || "/placeholder.svg"}
                  alt={track.title}
                  className="w-full h-full object-cover"
                />
                {isCurrent && (
                  <div className="absolute inset-0 bg-black/40 flex items-center justify-center">
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        togglePlay();
                      }}
                    >
                      {isPlaying ? <Pause /> : <Play />}
                    </button>
                  </div>
                )}
              </div>

              <div className="flex-1 min-w-0">
                <div className="font-medium truncate">{track.title}</div>
                <div className="text-sm text-muted-foreground truncate">
                  {track.artist}
                </div>
              </div>

              <AddToPlaylistButton
                trackId={track.id}
                trackTitle={track.title}
                variant="ghost"
              />
            </div>
          );
        })}
      </div>

      <div className="absolute left-2 top-2 z-10">
        <Button
          type="button"
          variant="ghost"
          size="icon"
          onClick={handleBack}
          aria-label="Back"
        >
          <ArrowLeft className="h-5 w-5" />
        </Button>
      </div>
    </div>
  );
};

export default Playlist;
