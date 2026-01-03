import { useEffect, useMemo } from "react";
import { useParams, useNavigate, Link } from "react-router-dom";
import { Play, Heart, ArrowLeft } from "lucide-react";

import { Button } from "@/components/ui/button";
import EmptyState from "@/components/ui/EmptyState";
import { Skeleton } from "@/components/ui/skeleton";
import AddToPlaylistButton from "@/components/AddToPlaylistButton";
import { usePlayer } from "@/contexts/PlayerContext";
import { useExternalPlaylist } from "@/hooks/useExternalPlaylist";
import useLikes from "@/hooks/useLikes";
import { useLanguage } from "@/contexts/LanguageContext";
import { PlaylistHeaderStats } from "@/components/playlists/PlaylistHeaderStats";
import { usePlaylistViewTracking } from "@/hooks/usePlaylistViewTracking";
import { deriveArtistKey } from "@/lib/artistKey";
import { useExistingArtistKeys } from "@/hooks/useExistingArtistKeys";

/* ===================== UTILS ===================== */

const formatDuration = (value?: number | string) => {
  if (!value) return null;
  if (typeof value === "string") return value;
  const minutes = Math.floor(value / 60);
  const seconds = value % 60;
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
};

/* ===================== COMPONENT ===================== */

const Playlist = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { t } = useLanguage();

  // ⬇️ IDENTIČNO KAO U Artist.tsx
  const { playPlaylist, currentTrackId } = usePlayer();
  const { trackView } = usePlaylistViewTracking();

  const { data: playlist, isLoading, error } = useExternalPlaylist(id || "");
  const { isPlaylistLiked, togglePlaylistLike } = useLikes();

  const isLiked = id ? isPlaylistLiked(id) : false;

  const artistNames = useMemo(
    () => (playlist?.tracks ?? []).map((t: any) => (t?.artist ? String(t.artist) : "")).filter(Boolean),
    [playlist?.tracks]
  );
  const { existingKeys: existingArtistKeys } = useExistingArtistKeys(artistNames);

  useEffect(() => {
    if (playlist?.id) {
      trackView(playlist.id);
    }
  }, [playlist?.id, trackView]);

  /* ===================== QUEUE ===================== */

  const playlistTracks = useMemo(() => {
    if (!playlist?.tracks?.length) return [];
    return playlist.tracks.map((t: any) => ({
      id: t.id,
      external_id: t.external_id ?? t.youtube_video_id,
      title: t.title,
      artist: t.artist,
    }));
  }, [playlist]);

  /* ===================== PLAY ===================== */

  const handlePlayAll = () => {
    if (!playlistTracks.length) return;
    playPlaylist(playlistTracks, 0);
  };

  const handlePlayTrack = (_trackId: string, index: number) => {
    playPlaylist(playlistTracks, index);
  };

  const handleToggleLike = async () => {
    if (!id) return;
    await togglePlaylistLike(id);
  };

  /* ===================== UI STATES ===================== */

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

  /* ===================== UI ===================== */

  return (
    <div className="relative flex-1 overflow-y-auto pb-32 bg-[linear-gradient(180deg,#07060B,#0B0814)]">
      {/* BACK */}
      <div className="absolute left-2 top-2 z-10">
        <Button variant="ghost" size="icon" onClick={() => navigate(-1)}>
          <ArrowLeft className="h-5 w-5" />
        </Button>
      </div>

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
          <button className="pm-cta-pill" onClick={handlePlayAll}>
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

      {/* TRACK LIST — ISTO KAO ARTIST */}
      <div className="mt-8 space-y-2 px-2">
        {playlist.tracks.map((track: any, index: number) => {
          const isActive = currentTrackId === track.id;
          const duration = formatDuration(track.duration);
          const artistName = track.artist || "";
          const artistKey = deriveArtistKey(artistName);
          const artistHref = artistKey && existingArtistKeys.has(artistKey)
            ? `/artist/${encodeURIComponent(artistKey)}`
            : null;

          return (
            <div
              key={track.id}
              onClick={() => handlePlayTrack(track.id, index)}
              className={`flex items-center gap-3 h-[64px] pr-3 cursor-pointer border rounded-[10px] transition ${
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

                {isActive && (
                  <div className="absolute inset-0 ring-2 ring-[#FF4FB7]/60 animate-pulse" />
                )}
              </div>

              {/* TEXT */}
              <div className="flex-1 min-w-0">
                <div className="font-medium truncate text-[#F6C66D]">
                  {track.title}
                </div>
                <div className="text-sm text-[#9A95B2] truncate">
                  {artistHref ? (
                    <Link
                      to={artistHref}
                      onClick={(e) => e.stopPropagation()}
                      className="underline decoration-dotted underline-offset-[3px] hover:text-[#F6C66D]"
                    >
                      {artistName}
                    </Link>
                  ) : (
                    artistName
                  )}
                </div>
              </div>

              {/* ACTIONS */}
              <div className="flex items-center gap-3 shrink-0">
                {duration && (
                  <span className="text-xs text-[#9A95B2] tabular-nums">
                    {duration}
                  </span>
                )}

                <button
                  type="button"
                  onClick={(e) => e.stopPropagation()}
                  className="opacity-70 hover:opacity-100 transition"
                >
                  <Heart className="w-4 h-4 text-[#CFA85B]" />
                </button>

                <AddToPlaylistButton
                  trackId={track.id}
                  trackTitle={track.title}
                  variant="ghost"
                />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};

export default Playlist;
