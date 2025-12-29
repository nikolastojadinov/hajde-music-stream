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
    <div className="fixed inset-0 z-50 flex flex-col bg-[radial-gradient(circle_at_50%_20%,rgba(124,58,237,0.18),transparent_40%),linear-gradient(180deg,#07060B,#0B0814)] backdrop-blur-xl text-[#F3F1FF]">
      <div className="flex items-center justify-between px-4 py-3 border-b border-white/10">
        <button onClick={() => setIsFullscreen(false)} className="h-10 w-10 rounded-full border border-white/10 text-[#CFA85B] hover:text-[#F6C66D]">
          <ChevronDown className="w-6 h-6 mx-auto" />
        </button>
        <button onClick={handleClose} className="h-10 w-10 rounded-full border border-white/10 text-[#8B86A3] hover:text-[#F3F1FF]">
          <X className="w-6 h-6 mx-auto" />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto px-4 pb-10 pt-6 flex flex-col items-center">
        <div
          className="w-full max-w-5xl rounded-2xl border border-white/10 bg-white/5 backdrop-blur-lg shadow-[0_10px_30px_rgba(0,0,0,0.45)]"
          style={{ aspectRatio: "16/9", minHeight: "300px", maxHeight: "70vh" }}
        />

        <div className="w-full max-w-xl text-center mt-8">
          <h2 className="text-[28px] font-bold text-[#F6C66D] mb-2 leading-tight">{currentVideoTitle}</h2>
          <p className="text-sm text-[#B7B2CC]">{currentVideoArtist}</p>
        </div>

        <div className="w-full max-w-xl mt-6">
          <Slider
            value={[progressPercentage]}
            max={100}
            step={0.1}
            className="mb-3"
            onValueChange={handleProgressChange}
          />
          <div className="flex justify-between text-xs text-[#8B86A3]">
            <span>{formatTime(currentTime)}</span>
            <span>{formatTime(duration)}</span>
          </div>
        </div>

        <div className="mt-8 flex items-center gap-6">
          <button onClick={skipBackward} className="h-12 w-12 rounded-full border border-white/10 text-[#CFA85B] hover:text-[#F6C66D]">
            <SkipBack className="w-6 h-6 mx-auto" />
          </button>
          <button
            onClick={togglePlay}
            className="h-16 w-16 rounded-full bg-gradient-to-r from-[#FF4FB7] to-[#A855F7] text-[#0B0814] shadow-lg shadow-[#FF4FB7]/30 hover:scale-105 active:scale-95 transition"
          >
            {isPlaying ? <Pause className="w-8 h-8 mx-auto" /> : <Play className="w-8 h-8 mx-auto fill-current ml-0.5" />}
          </button>
          <button onClick={skipForward} className="h-12 w-12 rounded-full border border-white/10 text-[#CFA85B] hover:text-[#F6C66D]">
            <SkipForward className="w-6 h-6 mx-auto" />
          </button>
        </div>

        <div className="mt-8 w-full max-w-xl flex items-center justify-between">
          <div className="flex items-center gap-3">
            <AddToPlaylistButton
              trackId={currentTrackId ?? undefined}
              trackTitle={currentVideoTitle}
              variant="ghost"
              triggerClassName="text-[#CFA85B] hover:text-[#F6C66D]"
            />
            <button
              onClick={handleToggleLike}
              disabled={likeDisabled}
              className={`transition ${isCurrentTrackLiked ? "text-[#FF4FB7]" : "text-[#CFA85B] hover:text-[#F6C66D]"} ${likeDisabled ? "opacity-50 cursor-not-allowed" : ""}`}
              aria-label={isCurrentTrackLiked ? "Unlike song" : "Like song"}
            >
              <Heart className={`w-7 h-7 ${isCurrentTrackLiked ? "fill-current" : ""}`} />
            </button>
          </div>
          <div className="flex items-center gap-3 w-40">
            <Volume2 className="w-5 h-5 text-[#8B86A3]" />
            <Slider value={[volume]} max={100} step={1} className="w-full" onValueChange={handleVolumeChange} />
          </div>
        </div>
      </div>
    </div>
  );
};

export default FullscreenPlayer;
