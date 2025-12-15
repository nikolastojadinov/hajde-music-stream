import { useEffect } from "react";
import { Pause, Play, SkipBack, SkipForward } from "lucide-react";
import { usePlayer } from "@/contexts/PlayerContext";

export default function MiniPlayer() {
  const {
    isPlaying,
    currentVideoTitle,
    currentVideoArtist,
    currentTrackId,
    isPlayerVisible,
    isFullscreen,
    setIsFullscreen,
    togglePlay,
    skipForward,
    skipBackward,
  } = usePlayer();

  useEffect(() => {
    if (isFullscreen) {
      setIsFullscreen(false);
    }
  }, [isFullscreen, setIsFullscreen]);

  const hasActiveTrack =
    Boolean(isPlayerVisible) &&
    (Boolean(currentTrackId) || Boolean(currentVideoTitle) || Boolean(currentVideoArtist));

  if (!hasActiveTrack) return null;

  return (
    <div className="fixed inset-x-0 bottom-0 z-40 border-t border-border bg-card/95 backdrop-blur-md">
      <div className="mx-auto flex max-w-screen-2xl items-center gap-3 px-4 py-3">
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-semibold text-foreground">{currentVideoTitle || ""}</div>
          <div className="truncate text-xs text-muted-foreground">{currentVideoArtist || ""}</div>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={skipBackward}
            className="inline-flex h-10 w-10 items-center justify-center rounded-full bg-secondary text-secondary-foreground transition-transform active:scale-95"
            aria-label="Previous"
          >
            <SkipBack className="h-5 w-5" />
          </button>

          <button
            type="button"
            onClick={togglePlay}
            className="inline-flex h-10 w-10 items-center justify-center rounded-full bg-primary text-primary-foreground transition-transform active:scale-95"
            aria-label={isPlaying ? "Pause" : "Play"}
            aria-pressed={isPlaying}
          >
            {isPlaying ? <Pause className="h-5 w-5" /> : <Play className="h-5 w-5 fill-current" />}
          </button>

          <button
            type="button"
            onClick={skipForward}
            className="inline-flex h-10 w-10 items-center justify-center rounded-full bg-secondary text-secondary-foreground transition-transform active:scale-95"
            aria-label="Next"
          >
            <SkipForward className="h-5 w-5" />
          </button>
        </div>
      </div>
    </div>
  );
}
