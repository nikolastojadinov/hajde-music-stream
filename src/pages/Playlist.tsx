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
    if (id && user?.uid) trackView(id);
  }, [id, user?.uid, trackView]);

  useEffect(() => {
    const fromArtist = Boolean((location.state as any)?.fromArtist);
    if (!fromArtist || !id || didArtistRefresh.current) return;

    didArtistRefresh.current = true;
    fetch(withBackendOrigin(`/api/playlists/${id}/refresh`), {
      method: "POST",
      credentials: "include",
    })
      .then(() => queryClient.invalidateQueries({ queryKey: ["external-playlist", id] }))
      .catch(() => {});
  }, [id, location.state, queryClient]);

  const handlePlayPlaylist = () => {
    if (!playlist || playlist.tracks.length === 0) return;
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

  const handlePlayTrack = (track: any, index: number) => {
    if (!playlist) return;
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
  };

  const handleBack = () => navigate(-1);

  if (isLoading) {
    return (
      <div className="flex-1 flex justify-center pt-20">
        <Skeleton className="w-48 h-48 rounded-md" />
      </div>
    );
  }

  if (error || !playlist) {
    return (
      <div className="flex-1 flex justify-center pt-20 px-4">
        <EmptyState title="Playlist unavailable" subtitle="Please try again later." />
      </div>
    );
  }

  return (
    <div className="relative flex-1 overflow-y-auto pb-32 bg-gradient-to-b from-[#07060B] to-[#0B0814]">
      {/* ===== HEADER ===== */}
      <div className="pt-8 px-4 text-center">
        <img
          src={playlist.cover_url || "/placeholder.svg"}
          className="mx-auto w-56 h-56 rounded-md object-cover shadow-lg border border-white/10"
        />

        <h1 className="mt-5 font-black text-[28px] text-[#F6C66D] line-clamp-2">
          {playlist.title}
        </h1>

        <p className="text-sm text-[#8B86A3] mt-1">
          {playlist.tracks.length} {t("songs")}
        </p>

        <div className="flex justify-center gap-4 mt-6">
          <button className="pm-cta-pill" onClick={handlePlayPlaylist}>
            <Play className="w-5 h-5 mr-1 text-[#FFD77A]" />
            {t("play_all")}
          </button>

          <button
            onClick={() => togglePlaylistLike(id!)}
            className="w-11 h-11 rounded-full border border-white/10 bg-white/5"
          >
            <Heart
              className={`w-5 h-5 ${
                isLiked ? "fill-[#FF4FB7] text-[#FF4FB7]" : "text-[#CFA85B]"
              }`}
            />
          </button>

          <PlaylistHeaderStats playlistId={id!} />
        </div>
      </div>

      {/* ===== TRACKS ===== */}
      <div className="mt-8 space-y-2">
        {playlist.tracks.map((track, index) => {
          const isCurrent = currentTrackId === track.id;

          return (
            <div
              key={track.id}
              onClick={() => handlePlayTrack(track, index)}
              className={`flex items-center gap-3 px-3 py-2 cursor-pointer border border-white/5 bg-white/5 hover:bg-white/10 transition
                ${isCurrent ? "border-[#FF4FB7]/50 bg-[#FF4FB7]/10 animate-pulse-soft" : ""}
              `}
            >
              {/* COVER */}
              <div className="w-12 h-12 overflow-hidden rounded-md bg-black">
                <img
                  src={track.cover_url || playlist.cover_url}
                  className="w-full h-full object-cover scale-[1.08]"
                />
              </div>

              {/* TEXT */}
              <div className="flex-1 min-w-0">
                <div className="font-medium truncate">{track.title}</div>
                <div className="text-sm text-muted-foreground truncate">
                  {track.artist}
                </div>
              </div>

              {/* RIGHT ACTIONS */}
              <div className="flex items-center gap-3 text-sm text-muted-foreground">
                <span>{track.duration || "--:--"}</span>
                <Heart className="w-4 h-4" />
                <AddToPlaylistButton trackId={track.id} trackTitle={track.title} />
              </div>
            </div>
          );
        })}
      </div>

      <Button
        variant="ghost"
        size="icon"
        onClick={handleBack}
        className="absolute left-2 top-2"
      >
        <ArrowLeft className="w-5 h-5" />
      </Button>
    </div>
  );
};

export default Playlist;
