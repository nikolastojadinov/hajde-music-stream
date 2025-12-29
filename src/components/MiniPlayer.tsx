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
    <div className="fixed bottom-20 md:bottom-0 left-0 right-0 bg-card/95 backdrop-blur-md border-t border-border z-30">
      <div className="relative">
        <div className="absolute bottom-2 right-3 z-20 md:hidden">
          <AddToPlaylistButton
            trackId={currentTrackId ?? undefined}
            trackTitle={currentVideoTitle}
            triggerClassName="bg-primary text-primary-foreground shadow-lg hover:bg-primary/90"
          />
        </div>

        <button
          onClick={() => setIsFullscreen(true)}
          className="absolute top-2 left-1/2 -translate-x-1/2 text-muted-foreground hover:text-foreground transition-colors z-10"
        >
          <ChevronUp className="w-5 h-5" />
        </button>

        <button
          onClick={handleClose}
          className="absolute top-2 right-2 text-muted-foreground hover:text-foreground transition-colors z-10"
        >
          <X className="w-5 h-5" />
        </button>

        <div className="flex items-center justify-between gap-2 max-w-screen-2xl mx-auto px-4 pt-3 py-1.5">
          <div className="flex items-center gap-2 flex-1 min-w-0">
            <div className={`${isMobile ? "w-[110px] h-[110px]" : "w-[200px] h-[200px]"} flex-shrink-0 bg-secondary/20 rounded-lg`} />
            <div className="min-w-0 flex-1 hidden md:block">
              <p className="font-semibold text-foreground truncate">{currentVideoTitle || "Purple Dreams"}</p>
              <p className="text-sm text-muted-foreground truncate">{currentVideoArtist || "Electronic Beats"}</p>
            </div>
          </div>

          <div className="flex items-center gap-4 flex-1 justify-center">
            <button onClick={skipBackward} className="text-foreground hover:text-primary transition-colors">
              <SkipBack className="w-6 h-6" />
            </button>

            <button
              onClick={togglePlay}
              className="w-12 h-12 bg-primary rounded-full flex items-center justify-center text-background hover:scale-105 transition-transform"
            >
              {isPlaying ? <Pause className="w-6 h-6" /> : <Play className="w-6 h-6 fill-current ml-0.5" />}
            </button>

            <button onClick={skipForward} className="text-foreground hover:text-primary transition-colors">
              <SkipForward className="w-6 h-6" />
            </button>

            <button
              onClick={handleToggleLike}
              disabled={likeDisabled}
              className={`transition-colors ${isCurrentTrackLiked ? "text-primary" : "text-muted-foreground hover:text-primary"} ${likeDisabled ? "opacity-50 cursor-not-allowed" : ""}`}
            >
              <Heart className={`w-6 h-6 ${isCurrentTrackLiked ? "fill-current" : ""}`} />
            </button>
          </div>

          <div className="hidden md:flex items-center gap-2 flex-1 justify-end">
            <AddToPlaylistButton
              trackId={currentTrackId ?? undefined}
              trackTitle={currentVideoTitle}
              variant="ghost"
              triggerClassName="text-muted-foreground hover:text-primary"
            />
            <Volume2 className="w-5 h-5 text-muted-foreground" />
            <Slider value={[volume]} max={100} step={1} className="w-24" onValueChange={handleVolumeChange} />
          </div>
        </div>
      </div>
    </div>
  );
};

export default MiniPlayer;
