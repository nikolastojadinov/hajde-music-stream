import { Play, Pause, SkipBack, SkipForward, Volume2, Heart, X, ChevronUp } from "lucide-react";
import { Slider } from "@/components/ui/slider";
import { usePlayer } from "@/contexts/PlayerContext";
import { useIsMobile } from "@/hooks/use-mobile";
import useLikes from "@/hooks/useLikes";
import AddToPlaylistButton from "@/components/AddToPlaylistButton";

const MiniPlayer = () => {
  const isMobile = useIsMobile();
  const {
    isPlaying,
    volume,
    currentVideoTitle,
    currentVideoArtist,
    currentTrackId,
    isFullscreen,
    isPlayerVisible,
    togglePlay,
    skipForward,
    skipBackward,
    setVolume: updateVolume,
    setIsFullscreen,
    setIsPlayerVisible,
  } = usePlayer();

  const { isTrackLiked, toggleTrackLike } = useLikes();
  const isCurrentTrackLiked = currentTrackId ? isTrackLiked(currentTrackId) : false;
  const likeDisabled = !currentTrackId;

  const handleClose = () => {
    if (isPlaying) {
      togglePlay();
    }
    setIsPlayerVisible(false);
  };

  const handleVolumeChange = (values: number[]) => {
    updateVolume(values[0]);
  };

  const handleToggleLike = () => {
    if (!currentTrackId) return;
    void toggleTrackLike(currentTrackId);
  };

  if (!isPlayerVisible || isFullscreen) return null;

  return (
    <div className="fixed bottom-20 md:bottom-0 left-0 right-0 z-30">
      <div className="mx-auto max-w-5xl rounded-2xl border border-white/10 bg-[rgba(14,12,22,0.92)] backdrop-blur-2xl shadow-[0_10px_30px_rgba(0,0,0,0.55)] px-4 py-3 md:py-4">
        <div className="flex items-center gap-3 md:gap-4">
          <button
            onClick={() => setIsFullscreen(true)}
            className="hidden md:flex h-9 w-9 items-center justify-center rounded-full border border-white/10 text-[#CFA85B] hover:text-[#F6C66D] transition"
            aria-label="Expand player"
          >
            <ChevronUp className="h-5 w-5" />
          </button>

          <div className="flex flex-1 items-center gap-3 min-w-0">
            <div className="h-[64px] w-[64px] md:h-[72px] md:w-[72px] rounded-[14px] bg-white/5 border border-white/10 overflow-hidden flex-shrink-0" />
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold text-[#F3F1FF] truncate">{currentVideoTitle || "Purple Midnight Energy"}</p>
              <p className="text-xs text-[#8B86A3] truncate">{currentVideoArtist || "Unknown artist"}</p>
              <div className="mt-2 h-1.5 rounded-full bg-white/10">
                <div className="h-full w-2/5 rounded-full bg-[#FF4FB7]" />
              </div>
            </div>
          </div>

          <div className="flex items-center justify-center gap-3 md:gap-4">
            <button onClick={skipBackward} className="text-[#CFA85B] hover:text-[#F6C66D] transition">
              <SkipBack className="h-6 w-6" />
            </button>
            <button
              onClick={togglePlay}
              className="h-14 w-14 rounded-full bg-gradient-to-r from-[#FF4FB7] to-[#A855F7] text-[#0B0814] shadow-lg shadow-[#FF4FB7]/30 transition-transform hover:scale-105 active:scale-95"
            >
              {isPlaying ? <Pause className="h-7 w-7" /> : <Play className="h-7 w-7 fill-current ml-0.5" />}
            </button>
            <button onClick={skipForward} className="text-[#CFA85B] hover:text-[#F6C66D] transition">
              <SkipForward className="h-6 w-6" />
            </button>
            <button
              onClick={handleToggleLike}
              disabled={likeDisabled}
              className={`transition ${isCurrentTrackLiked ? "text-[#FF4FB7]" : "text-[#CFA85B] hover:text-[#F6C66D]"} ${likeDisabled ? "opacity-50 cursor-not-allowed" : ""}`}
              aria-label={isCurrentTrackLiked ? "Unlike song" : "Like song"}
            >
              <Heart className={`h-6 w-6 ${isCurrentTrackLiked ? "fill-current" : ""}`} />
            </button>
            <AddToPlaylistButton
              trackId={currentTrackId ?? undefined}
              trackTitle={currentVideoTitle}
              variant="ghost"
              triggerClassName="hidden md:inline-flex text-[#CFA85B] hover:text-[#F6C66D]"
            />
            <div className="hidden md:flex items-center gap-2 w-28">
              <Volume2 className="h-5 w-5 text-[#8B86A3]" />
              <Slider value={[volume]} max={100} step={1} className="w-full" onValueChange={handleVolumeChange} />
            </div>
          </div>

          <div className="flex items-center gap-2 md:hidden">
            <button onClick={() => setIsFullscreen(true)} className="h-9 w-9 rounded-full border border-white/10 text-[#CFA85B] hover:text-[#F6C66D]" aria-label="Expand">
              <ChevronUp className="h-5 w-5 mx-auto" />
            </button>
            <button onClick={handleClose} className="h-9 w-9 rounded-full border border-white/10 text-[#8B86A3] hover:text-[#F3F1FF]" aria-label="Close">
              <X className="h-5 w-5 mx-auto" />
            </button>
            <AddToPlaylistButton
              trackId={currentTrackId ?? undefined}
              trackTitle={currentVideoTitle}
              triggerClassName="h-9 px-3 rounded-full bg-white/5 border border-white/10 text-xs text-[#F3F1FF]"
            />
          </div>
        </div>
      </div>
    </div>
  );
};

export default MiniPlayer;
