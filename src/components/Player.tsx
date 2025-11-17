import { Play, Pause, SkipBack, SkipForward, Volume2, Repeat, Shuffle, Heart, X, ChevronUp, ChevronDown } from "lucide-react";
import { Slider } from "@/components/ui/slider";
import { usePlayer } from "@/contexts/PlayerContext";
import { useIsMobile } from "@/hooks/use-mobile";
const Player = () => {
  const isMobile = useIsMobile();
  const {
    isPlaying,
    volume,
    currentTime,
    duration,
    isFullscreen,
    currentVideoTitle,
    currentVideoArtist,
    isLiked,
    isPlayerVisible,
    togglePlay,
    skipForward,
    skipBackward,
    setVolume: updateVolume,
    seekTo,
    formatTime,
    setIsFullscreen,
    toggleLike,
    setIsPlayerVisible
  } = usePlayer();
  const handleClose = () => {
    if (isPlaying) {
      togglePlay(); // Pauzira reprodukciju
    }
    setIsPlayerVisible(false);
  };
  const handleVolumeChange = (values: number[]) => {
    updateVolume(values[0]);
  };
  const handleProgressChange = (values: number[]) => {
    const newTime = values[0] / 100 * duration;
    seekTo(newTime);
  };
  const progressPercentage = duration > 0 ? currentTime / duration * 100 : 0;
  if (!isPlayerVisible) return null;

  // Fullscreen Player UI (bez player iframe-a - on je u YouTubePlayerContainer)
  if (isFullscreen) {
    return <div className="fixed inset-0 bg-background z-50 flex flex-col">
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
          <div className="w-full max-w-4xl mb-8" style={{ 
            aspectRatio: '16/9',
            minHeight: '300px',
            maxHeight: '70vh'
          }} />
          
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
            <button className="text-muted-foreground hover:text-foreground transition-colors">
              <Shuffle className="w-5 h-5" />
            </button>
            <button onClick={skipBackward} className="text-foreground hover:text-primary transition-colors">
              <SkipBack className="w-7 h-7" />
            </button>
            <button onClick={togglePlay} className="w-14 h-14 bg-primary rounded-full flex items-center justify-center text-background hover:scale-105 transition-transform">
              {isPlaying ? <Pause className="w-7 h-7" /> : <Play className="w-7 h-7 fill-current ml-1" />}
            </button>
            <button onClick={skipForward} className="text-foreground hover:text-primary transition-colors">
              <SkipForward className="w-7 h-7" />
            </button>
            <button className="text-muted-foreground hover:text-foreground transition-colors">
              <Repeat className="w-5 h-5" />
            </button>
          </div>

          {/* Volume */}
          <div className="w-full max-w-md flex items-center justify-between">
            <button onClick={toggleLike} className={`transition-colors ${isLiked ? 'text-primary' : 'text-muted-foreground hover:text-primary'}`}>
              <Heart className={`w-6 h-6 ${isLiked ? 'fill-current' : ''}`} />
            </button>
            <div className="flex items-center gap-3">
              <Volume2 className="w-5 h-5 text-muted-foreground" />
              <Slider value={[volume]} max={100} step={1} className="w-32" onValueChange={handleVolumeChange} />
            </div>
          </div>
        </div>
      </div>;
  }

  // Mini Player UI (bez player iframe-a - on je u YouTubePlayerContainer)
  return <div className="fixed bottom-20 md:bottom-0 left-0 right-0 bg-card/95 backdrop-blur-md border-t border-border z-30">
      <div className="relative">
        {/* Expand button */}
        <button onClick={() => setIsFullscreen(true)} className="absolute top-2 left-1/2 -translate-x-1/2 text-muted-foreground hover:text-foreground transition-colors z-10">
          <ChevronUp className="w-5 h-5" />
        </button>

        {/* Close button */}
        <button onClick={handleClose} className="absolute top-2 right-2 text-muted-foreground hover:text-foreground transition-colors z-10">
          <X className="w-5 h-5" />
        </button>

        <div className="flex items-center justify-between gap-2 max-w-screen-2xl mx-auto px-4 pt-3 py-1.5">
          {/* YouTube Player Placeholder - matches wrapper visual size */}
          <div className="flex items-center gap-2 flex-1 min-w-0">
            {/* Placeholder matches wrapper: 110px on mobile, 200px on desktop */}
            <div className={`${isMobile ? 'w-[110px] h-[110px]' : 'w-[200px] h-[200px]'} flex-shrink-0 bg-secondary/20 rounded-lg`} />
            <div className="min-w-0 flex-1 hidden md:block">
              <p className="font-semibold text-foreground truncate">{currentVideoTitle || "Purple Dreams"}</p>
              <p className="text-sm text-muted-foreground truncate">{currentVideoArtist || "Electronic Beats"}</p>
            </div>
          </div>

          {/* Controls - horizontal layout: Previous | Play | Next | Like */}
          <div className="flex items-center gap-4 flex-1 justify-center">
            <button onClick={skipBackward} className="text-foreground hover:text-primary transition-colors">
              <SkipBack className="w-6 h-6" />
            </button>
            
            <button onClick={togglePlay} className="w-12 h-12 bg-primary rounded-full flex items-center justify-center text-background hover:scale-105 transition-transform">
              {isPlaying ? <Pause className="w-6 h-6" /> : <Play className="w-6 h-6 fill-current ml-0.5" />}
            </button>
            
            <button onClick={skipForward} className="text-foreground hover:text-primary transition-colors">
              <SkipForward className="w-6 h-6" />
            </button>
            
            <button onClick={toggleLike} className={`transition-colors ${isLiked ? 'text-primary' : 'text-muted-foreground hover:text-primary'}`}>
              <Heart className={`w-6 h-6 ${isLiked ? 'fill-current' : ''}`} />
            </button>
          </div>

          {/* Volume */}
          <div className="hidden md:flex items-center gap-2 flex-1 justify-end">
            <Volume2 className="w-5 h-5 text-muted-foreground" />
            <Slider value={[volume]} max={100} step={1} className="w-24" onValueChange={handleVolumeChange} />
          </div>
        </div>
      </div>
    </div>;
};
export default Player;