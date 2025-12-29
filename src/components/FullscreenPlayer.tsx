import { Play, Pause, SkipBack, SkipForward, Volume2, Heart, X, ChevronDown } from "lucide-react";
import { Slider } from "@/components/ui/slider";
import { usePlayer } from "@/contexts/PlayerContext";
import useLikes from "@/hooks/useLikes";
import AddToPlaylistButton from "@/components/AddToPlaylistButton";

const FullscreenPlayer = () => {
  const {
    isPlaying,
    volume,
    currentTime,
    duration,
    isFullscreen,
    currentVideoTitle,
    currentVideoArtist,
    currentTrackId,
    isPlayerVisible,
    togglePlay,
    skipForward,
    skipBackward,
    setVolume: updateVolume,
    seekTo,
    formatTime,
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

  const handleProgressChange = (values: number[]) => {
    const newTime = (values[0] / 100) * duration;
    seekTo(newTime);
  };

  const handleToggleLike = () => {
    if (!currentTrackId) return;
    void toggleTrackLike(currentTrackId);
  };

  const progressPercentage = duration > 0 ? (currentTime / duration) * 100 : 0;
  if (!isPlayerVisible || !isFullscreen) return null;

  // Fullscreen Player UI (bez player iframe-a - on je u YouTubePlayerContainer)
  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-[radial-gradient(circle_at_40%_12%,rgba(245,194,107,0.18),transparent_40%),radial-gradient(circle_at_82%_14%,rgba(123,63,228,0.24),transparent_46%),linear-gradient(180deg,#0a0712,#04020a)] text-[#F3F1FF] overflow-hidden">
      <div className="flex items-center justify-between px-4 py-4 border-b border-white/10 bg-[rgba(8,6,14,0.8)] backdrop-blur-[18px]">
        <button onClick={() => setIsFullscreen(false)} className="h-11 w-11 rounded-full border border-[#F5C26B]/30 bg-white/5 text-[#F5C26B] hover:border-[#F5C26B]/70 hover:text-[#ffd78a] shadow-[0_10px_26px_rgba(0,0,0,0.45)]">
          <ChevronDown className="w-6 h-6 mx-auto" />
        </button>
        <button onClick={handleClose} className="h-11 w-11 rounded-full border border-white/15 bg-white/5 text-[#bcb6d4] hover:text-[#F3F1FF] hover:border-white/30 transition-colors shadow-[0_10px_26px_rgba(0,0,0,0.45)]">
          <X className="w-6 h-6 mx-auto" />
        </button>
      </div>

      <div className="flex-1 overflow-hidden px-4 pb-12 pt-6 flex flex-col items-center">
        <div className="w-full max-w-5xl pointer-events-none" style={{ aspectRatio: "16 / 9" }} />

        <div className="w-full max-w-xl text-center mt-8">
          <h2 className="text-[28px] font-bold text-[#F5C26B] mb-2 leading-tight drop-shadow-[0_4px_18px_rgba(245,194,107,0.35)]">{currentVideoTitle}</h2>
          <p className="text-sm text-[#C8C2DD]">{currentVideoArtist}</p>
        </div>

        <div className="w-full max-w-xl mt-7">
          <Slider
            value={[progressPercentage]}
            max={100}
            step={0.1}
            className="mb-3"
            trackClassName="bg-[#120c1d]/80"
            rangeClassName="bg-[linear-gradient(90deg,#F5C26B,#7B3FE4)]"
            thumbClassName="h-5 w-5 bg-[#0c0814] border-[1.5px] border-[#F5C26B] shadow-[0_0_10px_rgba(245,194,107,0.32)]"
            onValueChange={handleProgressChange}
          />
          <div className="flex justify-between text-xs text-[#9b94b6]">
            <span>{formatTime(currentTime)}</span>
            <span>{formatTime(duration)}</span>
          </div>
        </div>

        <div className="mt-9 flex items-center gap-8 text-[#F5C26B]">
          <button onClick={skipBackward} className="h-[52px] w-[52px] min-h-[52px] min-w-[52px] rounded-full border border-[#F5C26B]/30 bg-white/5 hover:border-[#F5C26B]/70 hover:text-[#ffd78a] transition-colors shadow-[0_12px_26px_rgba(0,0,0,0.45)]">
            <SkipBack className="w-7 h-7 mx-auto" />
          </button>
            <button
              onClick={togglePlay}
              className="pm-cta-button pm-cta-button--md flex items-center justify-center"
          >
            {isPlaying ? <Pause className="w-8 h-8 mx-auto" /> : <Play className="w-8 h-8 mx-auto fill-current ml-0.5" />}
          </button>
          <button onClick={skipForward} className="h-[52px] w-[52px] min-h-[52px] min-w-[52px] rounded-full border border-[#F5C26B]/30 bg-white/5 hover:border-[#F5C26B]/70 hover:text-[#ffd78a] transition-colors shadow-[0_12px_26px_rgba(0,0,0,0.45)]">
            <SkipForward className="w-7 h-7 mx-auto" />
          </button>
        </div>

        <div className="mt-10 w-full max-w-xl flex items-center justify-between">
          <div className="flex items-center gap-4">
              <AddToPlaylistButton
                trackId={currentTrackId ?? undefined}
                trackTitle={currentVideoTitle}
                variant="ghost"
                triggerClassName="pm-cta-button pm-cta-button--sm flex items-center justify-center"
              />
            <button
              onClick={handleToggleLike}
              disabled={likeDisabled}
              className={`transition ${isCurrentTrackLiked ? "text-[#F5C26B]" : "text-[#F5C26B] hover:text-[#ffd78a]"} ${likeDisabled ? "opacity-50 cursor-not-allowed" : ""}`}
              aria-label={isCurrentTrackLiked ? "Unlike song" : "Like song"}
            >
              <Heart className={`w-7 h-7 ${isCurrentTrackLiked ? "fill-current" : ""}`} />
            </button>
          </div>
          <div className="flex items-center gap-3 w-44">
            <Volume2 className="w-5 h-5 text-[#9b94b6]" />
            <Slider
              value={[volume]}
              max={100}
              step={1}
              className="w-full"
              trackClassName="bg-[#120c1d]/80"
              rangeClassName="bg-[linear-gradient(90deg,#F5C26B,#7B3FE4)]"
              thumbClassName="h-4 w-4 bg-[#0c0814] border-[1.5px] border-[#F5C26B] shadow-[0_0_8px_rgba(245,194,107,0.35)]"
              onValueChange={handleVolumeChange}
            />
          </div>
        </div>
      </div>
    </div>
  );
};

export default FullscreenPlayer;
