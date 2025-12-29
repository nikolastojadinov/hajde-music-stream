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
    <div className="fixed inset-0 z-50 flex flex-col bg-[radial-gradient(circle_at_50%_25%,rgba(124,58,237,0.25),transparent_38%),linear-gradient(180deg,#0a0812,#05030b)] backdrop-blur-2xl text-[#F3F1FF]">
      <div className="flex items-center justify-between px-4 py-3 border-b border-white/10 bg-[rgba(20,14,30,0.6)]">
        <button onClick={() => setIsFullscreen(false)} className="h-10 w-10 rounded-full border border-white/15 text-[#CFA85B] hover:text-[#F6C66D] shadow-[0_6px_18px_rgba(0,0,0,0.35)]">
          <ChevronDown className="w-6 h-6 mx-auto" />
        </button>
        <button onClick={handleClose} className="h-10 w-10 rounded-full border border-white/15 text-[#8B86A3] hover:text-[#F3F1FF] shadow-[0_6px_18px_rgba(0,0,0,0.35)]">
          <X className="w-6 h-6 mx-auto" />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto px-4 pb-10 pt-6 flex flex-col items-center">
        <div className="w-full max-w-5xl rounded-2xl bg-gradient-to-br from-[#F5C26B]/35 to-[#7B3FE4]/35 p-[1.5px] shadow-[0_24px_70px_rgba(0,0,0,0.55)]" style={{ aspectRatio: "16/9", minHeight: "300px", maxHeight: "70vh" }}>
          <div className="h-full w-full rounded-[18px] bg-[rgba(20,14,30,0.78)] border border-white/12 shadow-[0_18px_36px_rgba(0,0,0,0.45)]" />
        </div>

        <div className="w-full max-w-xl text-center mt-8">
          <h2 className="text-[28px] font-bold text-[#F6C66D] mb-2 leading-tight drop-shadow-[0_4px_18px_rgba(245,194,107,0.35)]">{currentVideoTitle}</h2>
          <p className="text-sm text-[#B7B2CC]">{currentVideoArtist}</p>
        </div>

        <div className="w-full max-w-xl mt-6">
          <Slider
            value={[progressPercentage]}
            max={100}
            step={0.1}
            className="mb-3"
            trackClassName="bg-[#1d1230]"
            rangeClassName="bg-gradient-to-r from-[#F5C26B] via-[#F08CFF] to-[#7B3FE4]"
            thumbClassName="h-5 w-5 bg-[#7B3FE4] border-2 border-[#F5C26B]"
            onValueChange={handleProgressChange}
          />
          <div className="flex justify-between text-xs text-[#8B86A3]">
            <span>{formatTime(currentTime)}</span>
            <span>{formatTime(duration)}</span>
          </div>
        </div>

        <div className="mt-8 flex items-center gap-6">
          <button onClick={skipBackward} className="h-12 w-12 rounded-full border border-white/15 text-[#F5C26B] hover:text-[#F08CFF] shadow-[0_10px_24px_rgba(0,0,0,0.35)]">
            <SkipBack className="w-6 h-6 mx-auto" />
          </button>
          <button
            onClick={togglePlay}
            className="h-16 w-16 rounded-full flex items-center justify-center text-[#0B0814] shadow-[0_18px_36px_rgba(240,140,255,0.4)] hover:scale-105 active:scale-95 transition-transform ring-2 ring-[#F5C26B] bg-[radial-gradient(circle_at_30%_30%,#F08CFF,#7B3FE4)]"
          >
            {isPlaying ? <Pause className="w-8 h-8 mx-auto" /> : <Play className="w-8 h-8 mx-auto fill-current ml-0.5" />}
          </button>
          <button onClick={skipForward} className="h-12 w-12 rounded-full border border-white/15 text-[#F5C26B] hover:text-[#F08CFF] shadow-[0_10px_24px_rgba(0,0,0,0.35)]">
            <SkipForward className="w-6 h-6 mx-auto" />
          </button>
        </div>

        <div className="mt-8 w-full max-w-xl flex items-center justify-between">
          <div className="flex items-center gap-3">
            <AddToPlaylistButton
              trackId={currentTrackId ?? undefined}
              trackTitle={currentVideoTitle}
              variant="ghost"
              triggerClassName="text-[#F5C26B] hover:text-[#F08CFF]"
            />
            <button
              onClick={handleToggleLike}
              disabled={likeDisabled}
              className={`transition ${isCurrentTrackLiked ? "text-[#F08CFF]" : "text-[#F5C26B] hover:text-[#F08CFF]"} ${likeDisabled ? "opacity-50 cursor-not-allowed" : ""}`}
              aria-label={isCurrentTrackLiked ? "Unlike song" : "Like song"}
            >
              <Heart className={`w-7 h-7 ${isCurrentTrackLiked ? "fill-current" : ""}`} />
            </button>
          </div>
          <div className="flex items-center gap-3 w-40">
            <Volume2 className="w-5 h-5 text-[#8B86A3]" />
            <Slider
              value={[volume]}
              max={100}
              step={1}
              className="w-full"
              trackClassName="bg-[#1d1230]"
              rangeClassName="bg-gradient-to-r from-[#F5C26B] via-[#F08CFF] to-[#7B3FE4]"
              thumbClassName="h-4 w-4 bg-[#7B3FE4] border-2 border-[#F5C26B]"
              onValueChange={handleVolumeChange}
            />
          </div>
        </div>
      </div>
    </div>
  );
};

export default FullscreenPlayer;
