import { Play, SkipBack, SkipForward, Volume2, Repeat, Shuffle, Heart, X } from "lucide-react";
import { Slider } from "@/components/ui/slider";
import { useState } from "react";
import testTrackCover from "@/assets/test-track-cover.jpg";

const Player = () => {
  const [isVisible, setIsVisible] = useState(true);

  if (!isVisible) return null;

  return (
    <div className="fixed bottom-20 md:bottom-0 left-0 right-0 bg-card/95 backdrop-blur-md border-t border-border z-30">
      <div className="relative">
        {/* Close button */}
        <button
          onClick={() => setIsVisible(false)}
          className="absolute top-2 right-2 text-muted-foreground hover:text-foreground transition-colors z-10"
        >
          <X className="w-5 h-5" />
        </button>

        <div className="flex items-center justify-between gap-4 max-w-screen-2xl mx-auto px-4 py-3">
          {/* Current Track Info */}
          <div className="flex items-center gap-4 flex-1 min-w-0">
            <div className="w-14 h-14 bg-secondary rounded-lg flex-shrink-0 overflow-hidden">
              <img src={testTrackCover} alt="Album cover" className="w-full h-full object-cover" />
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
              <button className="text-foreground hover:text-primary transition-colors">
                <SkipBack className="w-5 h-5" />
              </button>
              <button className="w-10 h-10 bg-primary rounded-full flex items-center justify-center text-background hover:scale-105 transition-transform">
                <Play className="w-5 h-5 fill-current ml-0.5" />
              </button>
              <button className="text-foreground hover:text-primary transition-colors">
                <SkipForward className="w-5 h-5" />
              </button>
              <button className="text-muted-foreground hover:text-foreground transition-colors hidden md:block">
                <Repeat className="w-4 h-4" />
              </button>
            </div>
            
            <div className="flex items-center gap-2 w-full">
              <span className="text-xs text-muted-foreground">2:34</span>
              <Slider defaultValue={[33]} max={100} step={1} className="flex-1" />
              <span className="text-xs text-muted-foreground">4:12</span>
            </div>
          </div>

          {/* Volume Controls */}
          <div className="hidden md:flex items-center gap-2 flex-1 justify-end">
            <Volume2 className="w-5 h-5 text-muted-foreground" />
            <Slider defaultValue={[70]} max={100} step={1} className="w-24" />
          </div>
        </div>
      </div>
    </div>
  );
};

export default Player;
