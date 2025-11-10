import { Play, Pause, SkipBack, SkipForward, Volume2, Repeat, Shuffle, Heart, X, ChevronUp, ChevronDown } from "lucide-react";
import { Slider } from "@/components/ui/slider";
import { useState } from "react";
import { usePlayer } from "@/contexts/PlayerContext";

const Player = () => {
  const [isVisible, setIsVisible] = useState(true);
  
  const {
    isPlaying,
    volume,
    currentTime,
    duration,
    isFullscreen,
    togglePlay,
    skipForward,
    skipBackward,
    setVolume: updateVolume,
    seekTo,
    formatTime,
    setIsFullscreen,
  } = usePlayer();

  // Ažuriraj volume kada korisnik pomeri slider
  const handleVolumeChange = (values: number[]) => {
    updateVolume(values[0]);
  };

  // Ažuriraj progress kada korisnik pomeri slider
  const handleProgressChange = (values: number[]) => {
    const newTime = (values[0] / 100) * duration;
    seekTo(newTime);
  };

  const progressPercentage = duration > 0 ? (currentTime / duration) * 100 : 0;

  if (!isVisible) return null;

  // Fullscreen Player
  if (isFullscreen) {
    return (
      <div className="fixed inset-0 bg-background z-50 flex flex-col animate-fade-in">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-border">
          <button
            onClick={() => setIsFullscreen(false)}
            className="text-foreground hover:text-primary transition-colors"
          >
            <ChevronDown className="w-6 h-6" />
          </button>
          <button
            onClick={() => setIsVisible(false)}
            className="text-muted-foreground hover:text-foreground transition-colors"
          >
            <X className="w-6 h-6" />
          </button>
        </div>

        {/* YouTube Video Player */}
        <div className="flex-1 flex flex-col items-center justify-center p-8">
          <div className="w-full max-w-md mb-8 aspect-square rounded-lg overflow-hidden shadow-2xl">
            <div 
              id="youtube-player-container" 
              className="w-full h-full"
              style={{ width: '100%', height: '100%' }}
            />
          </div>
          
          <div className="w-full max-w-md text-center mb-8">
            <h2 className="text-3xl font-bold mb-2 text-foreground">Purple Dreams</h2>
            <p className="text-lg text-muted-foreground">Electronic Beats</p>
          </div>

          {/* Progress Bar */}
          <div className="w-full max-w-md mb-8">
            <Slider 
              value={[progressPercentage]} 
              max={100} 
              step={0.1} 
              className="mb-2"
              onValueChange={handleProgressChange}
            />
            <div className="flex justify-between text-sm text-muted-foreground">
              <span>{formatTime(currentTime)}</span>
              <span>{formatTime(duration)}</span>
            </div>
          </div>

          {/* Controls */}
          <div className="flex items-center gap-8 mb-8">
            <button className="text-muted-foreground hover:text-foreground transition-colors">
              <Shuffle className="w-6 h-6" />
            </button>
            <button 
              onClick={() => skipBackward(10)}
              className="text-foreground hover:text-primary transition-colors"
            >
              <SkipBack className="w-8 h-8" />
            </button>
            <button 
              onClick={togglePlay}
              className="w-16 h-16 bg-primary rounded-full flex items-center justify-center text-background hover:scale-105 transition-transform shadow-lg"
            >
              {isPlaying ? (
                <Pause className="w-8 h-8" />
              ) : (
                <Play className="w-8 h-8 fill-current ml-1" />
              )}
            </button>
            <button 
              onClick={() => skipForward(10)}
              className="text-foreground hover:text-primary transition-colors"
            >
              <SkipForward className="w-8 h-8" />
            </button>
            <button className="text-muted-foreground hover:text-foreground transition-colors">
              <Repeat className="w-6 h-6" />
            </button>
          </div>

          {/* Volume & Extra Controls */}
          <div className="w-full max-w-md flex items-center justify-between">
            <button className="text-primary hover:scale-110 transition-transform">
              <Heart className="w-6 h-6 fill-current" />
            </button>
            <div className="flex items-center gap-3">
              <Volume2 className="w-5 h-5 text-muted-foreground" />
              <Slider 
                value={[volume]} 
                max={100} 
                step={1} 
                className="w-32"
                onValueChange={handleVolumeChange}
              />
            </div>
          </div>
        </div>
      </div>
    );
  }

  // Mini Player
  return (
    <div className="fixed bottom-20 md:bottom-0 left-0 right-0 bg-card/95 backdrop-blur-md border-t border-border z-30">
      <div className="relative">
        {/* Expand button */}
        <button
          onClick={() => setIsFullscreen(true)}
          className="absolute top-2 left-1/2 -translate-x-1/2 text-muted-foreground hover:text-foreground transition-colors z-10"
        >
          <ChevronUp className="w-5 h-5" />
        </button>

        {/* Close button */}
        <button
          onClick={() => setIsVisible(false)}
          className="absolute top-2 right-2 text-muted-foreground hover:text-foreground transition-colors z-10"
        >
          <X className="w-5 h-5" />
        </button>

        <div className="flex items-center justify-between gap-4 max-w-screen-2xl mx-auto px-4 py-3 pt-8">
          {/* Current Track Info with YouTube Player */}
          <div className="flex items-center gap-4 flex-1 min-w-0">
            <div className="rounded-lg flex-shrink-0 overflow-hidden" style={{ width: '200px', height: '200px' }}>
              <div 
                id="youtube-player-container" 
                style={{ width: '200px', height: '200px' }}
              />
            </div>
            <div className="min-w-0 flex-1 hidden md:block">
              <p className="font-semibold text-foreground truncate">Purple Dreams</p>
              <p className="text-sm text-muted-foreground truncate">Electronic Beats</p>
            </div>
            <button className="text-muted-foreground hover:text-primary transition-colors flex-shrink-0 hidden md:block">
              <Heart className="w-5 h-5" />
            </button>
          </div>

          {/* Player Controls */}
          <div className="flex flex-col items-center gap-2 flex-1 max-w-2xl">
            <div className="flex items-center gap-4">
              <button className="text-muted-foreground hover:text-foreground transition-colors hidden md:block">
                <Shuffle className="w-4 h-4" />
              </button>
              <button 
                onClick={() => skipBackward(10)}
                className="text-foreground hover:text-primary transition-colors"
              >
                <SkipBack className="w-5 h-5" />
              </button>
              <button 
                onClick={togglePlay}
                className="w-10 h-10 bg-primary rounded-full flex items-center justify-center text-background hover:scale-105 transition-transform"
              >
                {isPlaying ? (
                  <Pause className="w-5 h-5" />
                ) : (
                  <Play className="w-5 h-5 fill-current ml-0.5" />
                )}
              </button>
              <button 
                onClick={() => skipForward(10)}
                className="text-foreground hover:text-primary transition-colors"
              >
                <SkipForward className="w-5 h-5" />
              </button>
              <button className="text-muted-foreground hover:text-foreground transition-colors hidden md:block">
                <Repeat className="w-4 h-4" />
              </button>
            </div>
            
            <div className="flex items-center gap-2 w-full">
              <span className="text-xs text-muted-foreground">{formatTime(currentTime)}</span>
              <Slider 
                value={[progressPercentage]} 
                max={100} 
                step={0.1} 
                className="flex-1"
                onValueChange={handleProgressChange}
              />
              <span className="text-xs text-muted-foreground">{formatTime(duration)}</span>
            </div>
          </div>

          {/* Volume Controls */}
          <div className="hidden md:flex items-center gap-2 flex-1 justify-end">
            <Volume2 className="w-5 h-5 text-muted-foreground" />
            <Slider 
              value={[volume]} 
              max={100} 
              step={1} 
              className="w-24"
              onValueChange={handleVolumeChange}
            />
          </div>
        </div>
      </div>
    </div>
  );
};

export default Player;
