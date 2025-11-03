import { Play, SkipBack, SkipForward, Volume2, Repeat, Shuffle, Heart } from "lucide-react";
import { Slider } from "@/components/ui/slider";

const Player = () => {
  return (
    <div className="fixed bottom-0 left-0 right-0 bg-card border-t border-border px-4 py-3">
      <div className="flex items-center justify-between gap-4 max-w-screen-2xl mx-auto">
        {/* Current Track Info */}
        <div className="flex items-center gap-4 flex-1 min-w-0">
          <div className="w-14 h-14 bg-secondary rounded-lg flex-shrink-0 overflow-hidden">
            <div className="w-full h-full bg-gradient-to-br from-primary/20 to-primary/5" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="font-semibold text-foreground truncate">Trenutna pesma</p>
            <p className="text-sm text-muted-foreground truncate">Izvođač</p>
          </div>
          <button className="text-muted-foreground hover:text-primary transition-colors flex-shrink-0">
            <Heart className="w-5 h-5" />
          </button>
        </div>

        {/* Player Controls */}
        <div className="flex flex-col items-center gap-2 flex-1 max-w-2xl">
          <div className="flex items-center gap-4">
            <button className="text-muted-foreground hover:text-foreground transition-colors">
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
            <button className="text-muted-foreground hover:text-foreground transition-colors">
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
        <div className="flex items-center gap-2 flex-1 justify-end">
          <Volume2 className="w-5 h-5 text-muted-foreground" />
          <Slider defaultValue={[70]} max={100} step={1} className="w-24" />
        </div>
      </div>
    </div>
  );
};

export default Player;
