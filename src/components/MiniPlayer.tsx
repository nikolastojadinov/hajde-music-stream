import { Heart, Play, Pause } from "lucide-react";
import { usePlayer } from "@/contexts/PlayerContext";
import { useIsMobile } from "@/hooks/use-mobile";

const MiniPlayer = () => {
  const isMobile = useIsMobile();
  const {
    isPlaying,
    currentTitle,
    currentArtist,
    currentThumbnailUrl,
    isFullscreen,
    isPlayerVisible,
    togglePlay,
    setIsFullscreen,
  } = usePlayer();

  if (!isPlayerVisible || isFullscreen) return null;

  const fallbackTitle = currentTitle || "Now playing";
  const fallbackArtist = currentArtist || "YouTube Music";

  return (
    <div className="fixed bottom-[70px] md:bottom-2 left-0 right-0 z-30">
      <div
        role="button"
        tabIndex={0}
        onClick={() => setIsFullscreen(true)}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            setIsFullscreen(true);
          }
        }}
        className="mx-auto flex w-full max-w-screen-2xl items-center justify-between gap-3 bg-[rgba(10,8,15,0.9)] px-3 py-2 shadow-[0_-6px_30px_rgba(0,0,0,0.45)] backdrop-blur-md"
      >
        <div className="flex min-w-0 flex-1 items-center gap-3">
          <div
            id="yt-player-slot-mini"
            className={`${isMobile ? "w-12 h-12" : "w-14 h-14"} flex-shrink-0 rounded-lg bg-[rgba(20,14,30,0.65)] overflow-hidden border border-white/5`}
            style={currentThumbnailUrl ? { backgroundImage: `url(${currentThumbnailUrl})`, backgroundSize: "cover", backgroundPosition: "center" } : undefined}
            aria-hidden
          />
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold text-white/90">{fallbackTitle}</p>
            <p className="truncate text-xs text-neutral-400">{fallbackArtist}</p>
          </div>
        </div>

        <div className="flex items-center gap-3 pr-1">
          <button
            type="button"
            onClick={(e) => e.stopPropagation()}
            className="flex h-9 w-9 items-center justify-center rounded-full text-neutral-300 transition hover:text-white"
            aria-label="Like song"
          >
            <Heart className="h-5 w-5" />
          </button>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              togglePlay();
            }}
            className="flex h-9 w-9 items-center justify-center rounded-full bg-white text-neutral-900 shadow-[0_10px_24px_rgba(0,0,0,0.25)] transition hover:bg-neutral-100"
            aria-label={isPlaying ? "Pause" : "Play"}
          >
            {isPlaying ? <Pause className="h-5 w-5" /> : <Play className="h-5 w-5" />}
          </button>
        </div>
      </div>
    </div>
  );
};

export default MiniPlayer;
