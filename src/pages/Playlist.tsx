import { useEffect, useMemo } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { Play, Heart, ArrowLeft } from "lucide-react";
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

const formatDuration = (value?: number | string) => {
  if (!value) return null;
  if (typeof value === "string") return value;
  const minutes = Math.floor(value / 60);
  const seconds = value % 60;
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
};

const Playlist = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();

  const {
    playPlaylist,
    currentTrackId,
    isPlaying,
  } = usePlayer();

  const { isPlaylistLiked, togglePlaylistLike } = useLikes();
  const { t } = useLanguage();
  const { mutate } = useSWRConfig();
  const { user } = usePi();
  const { trackView } = usePlaylistViewTracking();

  const { data: playlist, isLoading, error } = useExternalPlaylist(id || "");
  const isLiked = id ? isPlaylistLiked(id) : false;

  const statsKey = useMemo(
    () => (id ? withBackendOrigin(`/api/playlists/${id}/public-stats`) : null),
    [id]
  );

  useEffect(() => {
    if (id && user?.uid) trackView(id);
  }, [id, user?.uid, trackView]);

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
  };

  const handlePlayTrack = (index: number) => {
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
  };

  const handleToggleLike = async () => {
    if (!id) return;
    await togglePlaylistLike(id);
    if (statsKey) mutate(statsKey);
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
        <EmptyState title="Playlist unavailable" subtitle="Please try again later." />
      </div>
    );
  }

  return (
    <div className="relative flex-1 overflow-y-auto pb-32 bg-[linear-gradient(180deg,#07060B,#0B0814)]">
      {/* HEADER */}
      <div className="pt-8 px-4 text-center">
        <div className="flex justify-center mb-5">
          <img
            src={playlist.cover_url || "/placeholder.svg"}
            alt={playlist.title}
            className="w-56 h-56 rounded-[14px] object-cover shadow-lg border border-white/10"
          />
        </div>

        <h1 className="font-black text-[30px] leading-tight text-[#F6C66D] line-clamp-2">
          {playlist.title}
        </h1>

        <p className="text-sm text-[#8B86A3] mt-1">
          {playlist.tracks.length} {t("songs")}
        </p>

        <div className="flex justify-center items-center gap-4 mt-6">
          <button className="pm-cta-pill" onClick={handlePlayPlaylist}>
            <span className="pm-cta-pill-inner">
              <Play className="w-5 h-5 mr-1 text-[#FFD77A]" />
              {t("play_all")}
            </span>
          </button>

          <button
            onClick={handleToggleLike}
            className="w-12 h-12 rounded-full border border-white/10 bg-white/5 flex items-center justify-center"
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

      {/* TRACK LIST */}
      <div className="mt-8 space-y-2 px-2">
        {playlist.tracks.map((track, index) => {
          const isActive = currentTrackId === track.id;
          const duration = formatDuration(track.duration);

          return (
            <div
              key={track.id}
              onClick={() => handlePlayTrack(index)}
              className={`group flex items-center gap-3 h-[64px] pr-3 cursor-pointer border rounded-[10px] transition ${
                isActive
                  ? "border-[#FF4FB7]/60 bg-[#FF4FB7]/10"
                  : "border-white/5 bg-white/5 hover:bg-white/10"
              }`}
            >
              {/* COVER */}
              <div className="relative w-[56px] h-full overflow-hidden rounded-l-[8px]">
                <img
                  src={track.cover_url || playlist.cover_url || "/placeholder.svg"}
                  alt={track.title}
                  className="absolute inset-0 w-full h-full object-cover scale-[1.15]"
                />

                {isActive && isPlaying && (
                  <div className="absolute inset-0 bg-black/40 flex items-center justify-center">
                    <div className="flex gap-[2px]">
                      <span className="pm-eq-bar" />
                      <span className="pm-eq-bar delay-1" />
                      <span className="pm-eq-bar delay-2" />
                    </div>
                  </div>
                )}
              </div>

              {/* TEXT */}
              <div className="flex-1 min-w-0">
                <div className="font-medium truncate text-[#F6C66D]">
                  {track.title}
                </div>
                <div className="text-sm text-[#9A95B2] truncate">
                  {track.artist}
                </div>
              </div>

              {/* ACTIONS */}
              <div className="flex items-center gap-3 shrink-0">
                {duration && (
                  <span className="text-xs text-[#9A95B2] tabular-nums">
                    {duration}
                  </span>
                )}

                <AddToPlaylistButton
                  trackId={track.id}
