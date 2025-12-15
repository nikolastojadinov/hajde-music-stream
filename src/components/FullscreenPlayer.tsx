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
    <div className="fixed inset-0 bg-background z-50 flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between p-4 border-b border-border">
        <button onClick={() => setIsFullscreen(false)} className="text-foreground hover:text-primary transition-colors">
          <ChevronDown className="w-6 h-6" />
        </button>
        <button onClick={handleClose} className="text-muted-foreground hover:text-foreground transition-colors">
          <X className="w-6 h-6" />
        </button>
      </div>

      {/* Content - stacked vertically, not centered */}
      <div className="flex-1 flex flex-col items-center overflow-y-auto p-4 pt-8">
        {/* YouTube Player space - YouTubePlayerContainer renders here as fixed element */}
        {/* Reserve space for the video player at top */}
        <div
          className="w-full max-w-4xl mb-8"
          style={{
            aspectRatio: "16/9",
            minHeight: "300px",
            maxHeight: "70vh",
          }}
        />

        <div className="w-full max-w-md text-center mb-6">
          <h2 className="text-2xl font-bold mb-1 text-foreground">{currentVideoTitle}</h2>
          <p className="text-muted-foreground">{currentVideoArtist}</p>
        </div>

        {/* Progress Bar */}
        <div className="w-full max-w-md mb-6">
          <Slider value={[progressPercentage]} max={100} step={0.1} className="mb-2" onValueChange={handleProgressChange} />
          <div className="flex justify-between text-sm text-muted-foreground">
            <span>{formatTime(currentTime)}</span>
            <span>{formatTime(duration)}</span>
          </div>
        </div>

        {/* Controls */}
        <div className="flex items-center gap-6 mb-6">
          <button onClick={skipBackward} className="text-foreground hover:text-primary transition-colors">
            <SkipBack className="w-7 h-7" />
          </button>
          <button
            onClick={togglePlay}
            className="w-14 h-14 bg-primary rounded-full flex items-center justify-center text-background hover:scale-105 transition-transform"
          >
            {isPlaying ? <Pause className="w-7 h-7" /> : <Play className="w-7 h-7 fill-current ml-1" />}
          </button>
          <button onClick={skipForward} className="text-foreground hover:text-primary transition-colors">
            <SkipForward className="w-7 h-7" />
          </button>
        </div>

        {/* Volume & Actions */}
        <div className="w-full max-w-md flex items-center justify-between">
          <div className="flex items-center gap-2">
            <AddToPlaylistButton
              trackId={currentTrackId ?? undefined}
              trackTitle={currentVideoTitle}
              variant="ghost"
              triggerClassName="text-muted-foreground hover:text-primary"
            />
            <button
              onClick={handleToggleLike}
              disabled={likeDisabled}
              className={`transition-colors ${isCurrentTrackLiked ? "text-primary" : "text-muted-foreground hover:text-primary"} ${likeDisabled ? "opacity-50 cursor-not-allowed" : ""}`}
              aria-label={isCurrentTrackLiked ? "Unlike song" : "Like song"}
            >
              <Heart className={`w-6 h-6 ${isCurrentTrackLiked ? "fill-current" : ""}`} />
            </button>
          </div>
          <div className="flex items-center gap-3">
            <Volume2 className="w-5 h-5 text-muted-foreground" />
            <Slider value={[volume]} max={100} step={1} className="w-32" onValueChange={handleVolumeChange} />
          </div>
        </div>
      </div>
    </div>
  );
};

export default FullscreenPlayer;
