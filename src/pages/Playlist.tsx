import { useEffect, useMemo, useRef, useState } from "react";
import { useParams, useNavigate, useLocation } from "react-router-dom";
import { Play, Pause, Heart, ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { usePlayer } from "@/contexts/PlayerContext";
import { Skeleton } from "@/components/ui/skeleton";
import { useExternalPlaylist } from "@/hooks/useExternalPlaylist";
import EmptyState from "@/components/ui/EmptyState";
import useLikes from "@/hooks/useLikes";
import { useLanguage } from "@/contexts/LanguageContext";
import { usePi } from "@/contexts/PiContext";
import { PlaylistHeaderStats } from "@/components/playlists/PlaylistHeaderStats";
import { useSWRConfig } from "swr";
import { withBackendOrigin } from "@/lib/backendUrl";
import { usePlaylistViewTracking } from "@/hooks/usePlaylistViewTracking";
import AddToPlaylistButton from "@/components/AddToPlaylistButton";
import { useQueryClient } from "@tanstack/react-query";
import { dedupeEvent } from "@/lib/requestDeduper";

const Playlist = () => {
  const { id } = useParams<{ id: string }>();
  const { playPlaylist, isPlaying, togglePlay } = usePlayer();
  const { isPlaylistLiked, togglePlaylistLike } = useLikes();
  const { t } = useLanguage();
  const [currentTrackId, setCurrentTrackId] = useState<string | null>(null);
  const { mutate } = useSWRConfig();
  const { user } = usePi();
  const { trackView } = usePlaylistViewTracking();
  const navigate = useNavigate();
  const location = useLocation();
  const queryClient = useQueryClient();
  const didArtistRefresh = useRef(false);

  const { data: playlist, isLoading, error } = useExternalPlaylist(id || "");
  const isLiked = id ? isPlaylistLiked(id) : false;
  const viewedSession = useRef<Set<string>>(new Set());

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
    const fromArtist = Boolean((location.state as any)?.fromArtist);
    if (!fromArtist || !id || didArtistRefresh.current) return;

    didArtistRefresh.current = true;
    const url = withBackendOrigin(`/api/playlists/${id}/refresh`);

    fetch(url, { method: "POST", credentials: "include" })
      .then((res) => {
        if (!res.ok) throw new Error("playlist_refresh_failed");
      })
      .then(() => queryClient.invalidateQueries({ queryKey: ["external-playlist", id] }))
      .catch(() => {
        // Silent: playlist page should still work with cached/local data.
      });
  }, [id, location.state, queryClient]);

  useEffect(() => {
    if (!id || !user?.uid || !viewUrl) return;
    const sessionKey = `${user.uid}:${id}`;
    if (viewedSession.current.has(sessionKey)) return;

    viewedSession.current.add(sessionKey);

    const viewPromise = dedupeEvent(
      `POST:public-view:${sessionKey}`,
      5000,
      async () => {
        const res = await fetch(viewUrl, {
          method: "POST",
          credentials: "include",
          headers: {
            "X-Pi-User-Id": user.uid,
            "X-Pi-Username": user.username ?? "",
            "X-Pi-Premium": user.premium ? "true" : "false",
            "X-Pi-Premium-Until": user.premium_until ?? "",
          },
        });

        if (!res.ok) return null;
        try {
          return (await res.json()) as { stats?: { likes?: number; views?: number } } | null;
        } catch (_) {
          return null;
        }
      }
    );

    if (viewPromise) {
      viewPromise
        .then((payload) => {
          if (statsKey && payload?.stats) {
            mutate(statsKey, payload.stats, false);
          }
        })
        .catch(() => {
          /* silent */
        });
    }
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
    return (
      <div className="flex-1 overflow-y-auto pb-32 flex justify-center pt-20 px-4">
        <EmptyState title={t("playlist_unavailable") || "Playlist unavailable"} subtitle={t("try_again_later") || "Please try again later."} />
      </div>
    );
  }

  return (
    <div className="relative flex-1 overflow-y-auto pb-32 bg-[radial-gradient(circle_at_50%_20%,rgba(124,58,237,0.12),transparent_42%),linear-gradient(180deg,#07060B,#0B0814)]">
      {/* ===== HEADER ===== */}
      <div className="pt-8 px-4 text-center">
        <div className="flex justify-center mb-5">
          <img
            src={playlist.cover_url || "/placeholder.svg"}
            alt={playlist.title}
            className="w-56 h-56 rounded-[22px] object-cover shadow-[0_10px_30px_rgba(0,0,0,0.45)] border border-white/10"
          />
        </div>

        <h1
          className="font-black text-[30px] leading-tight line-clamp-2 text-[#F6C66D]"
          style={{
            fontSize:
              playlist.title.length > 60
                ? "24px"
                : playlist.title.length > 40
                ? "26px"
                : "30px",
          }}
        >
          {playlist.title}
        </h1>

        <p className="text-sm text-[#8B86A3] mt-1">
          {playlist.tracks.length} {t("songs")}
        </p>

        <div className="flex justify-center items-center gap-4 mt-6">
          <button className="pm-cta-pill" onClick={handlePlayPlaylist}>
            <span className="pm-cta-pill-inner">
              <Play className="w-5 h-5 mr-1 stroke-[2.2] text-[#FFD77A]" />
              {t("play_all")}
            </span>
          </button>

          <button
            onClick={handleToggleLike}
            className="w-12 h-12 rounded-full border border-white/10 bg-white/5 flex items-center justify-center transition hover:border-[#FF4FB7]/40"
          >
            <Heart
              className={`w-6 h-6 ${
                isLiked ? "fill-[#FF4FB7] text-[#FF4FB7]" : "text-[#CFA85B]"
              }`}
            />
          </button>

          {id && <PlaylistHeaderStats playlistId={id} />}
        </div>
      </div>

      {/* ===== TRACK LIST ===== */}
      <div className="px-4 mt-8 space-y-2">
        {playlist.tracks.length === 0 ? (
          <EmptyState title={t("no_tracks_available") || "No tracks available"} subtitle={t("playlist_empty") || "This playlist does not contain any tracks."} />
        ) : (
          playlist.tracks.map((track, index) => {
            const isCurrent = currentTrackId === track.id;
            return (
              <div
                key={track.id}
                onClick={() => handlePlayTrack(track, index)}
                className={`flex items-center gap-3 p-3 rounded-[16px] cursor-pointer border border-white/5 bg-white/5 hover:bg-white/10 transition ${
                  isCurrent ? "border-[#FF4FB7]/50 bg-[#FF4FB7]/5" : ""
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
          })
        )}
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
