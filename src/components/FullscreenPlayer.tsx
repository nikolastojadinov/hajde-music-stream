import { useMemo, useState } from "react";
import { X, Pause, Play, SkipBack, SkipForward } from "lucide-react";
import { Slider } from "@/components/ui/slider";
import { usePlayer } from "@/contexts/PlayerContext";
import { useIsMobile } from "@/hooks/use-mobile";

export default function FullscreenPlayer() {
  const isMobile = useIsMobile();
  const {
    isFullscreen,
    setIsFullscreen,
    isPlaying,
    currentTime,
    duration,
    currentVideoTitle,
    currentVideoArtist,
    isPlayerVisible,
    togglePlay,
    skipForward,
    skipBackward,
    seekTo,
    formatTime,
  } = usePlayer();

  const [isScrubbing, setIsScrubbing] = useState(false);
  const [scrubPercentage, setScrubPercentage] = useState(0);

  const hasActiveTrack = Boolean(isPlayerVisible) && (Boolean(currentVideoTitle) || Boolean(currentVideoArtist));
  const open = Boolean(isFullscreen) && hasActiveTrack;

  const safeDuration = Number.isFinite(duration) && duration > 0 ? duration : 0;
  const progressPercentage = useMemo(() => {
    if (!safeDuration) return 0;
    const pct = (currentTime / safeDuration) * 100;
    if (!Number.isFinite(pct)) return 0;
    return Math.max(0, Math.min(100, pct));
  }, [currentTime, safeDuration]);

  const displayPercentage = isScrubbing ? scrubPercentage : progressPercentage;
  const previewSeconds = useMemo(() => {
    if (!safeDuration) return 0;
    return (displayPercentage / 100) * safeDuration;
  }, [displayPercentage, safeDuration]);

  const close = () => setIsFullscreen(false);

  const handleBackdropClick = () => {
    if (!isMobile) close();
  };

  const handleSliderChange = (values: number[]) => {
    setIsScrubbing(true);
    setScrubPercentage(values[0] ?? 0);
  };

  const handleSliderCommit = (values: number[]) => {
    const pct = values[0] ?? 0;
    setIsScrubbing(false);
    setScrubPercentage(pct);

    if (!safeDuration) return;
    const seconds = (pct / 100) * safeDuration;
    seekTo(seconds);
  };

  return (
    <div
      className={`fixed inset-0 z-50 transition-opacity duration-200 ${open ? "opacity-100" : "pointer-events-none opacity-0"}`}
      aria-hidden={!open}
    >
      <div
        className={`absolute inset-0 bg-black/70 transition-opacity duration-200 ${open ? "opacity-100" : "opacity-0"}`}
        onClick={handleBackdropClick}
      />

      <div className="relative mx-auto flex h-full w-full max-w-screen-md flex-col bg-background text-foreground">
        <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-3">
          <div className="min-w-0">
            <div className="truncate text-sm font-semibold">{currentVideoTitle || ""}</div>
            <div className="truncate text-xs text-muted-foreground">{currentVideoArtist || ""}</div>
          </div>
          <button
            type="button"
            onClick={close}
            className="inline-flex h-10 w-10 items-center justify-center rounded-full bg-secondary text-secondary-foreground transition-transform active:scale-95"
            aria-label="Close"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-4 pb-28 pt-4">
          {/* YouTube player area: YouTubePlayerContainer renders the real iframe above this overlay (z-index 55).
              This placeholder reserves space so our controls never obscure the player.
              The real iframe must remain visible (>=200x200). */}
          <div className="mx-auto w-full max-w-screen-md">
            <div className="mx-auto w-full max-w-[896px] rounded-lg bg-black" style={{ minHeight: 220 }} />
          </div>

          <div className="mt-6">
            <div className="mx-auto aspect-square w-full max-w-[360px] overflow-hidden rounded-2xl bg-secondary" />
          </div>

          <div className="mt-6">
            <Slider
              value={[displayPercentage]}
              max={100}
              step={0.1}
              onValueChange={handleSliderChange}
              onValueCommit={handleSliderCommit}
            />
            <div className="mt-2 flex items-center justify-between text-xs text-muted-foreground">
              <span>{formatTime(isScrubbing ? previewSeconds : currentTime)}</span>
              <span>{formatTime(safeDuration)}</span>
            </div>
          </div>

          <div className="mt-6 flex items-center justify-center gap-4">
            <button
              type="button"
              onClick={skipBackward}
              className="inline-flex h-12 w-12 items-center justify-center rounded-full bg-secondary text-secondary-foreground transition-transform active:scale-95"
              aria-label="Previous"
            >
              <SkipBack className="h-6 w-6" />
            </button>

            <button
              type="button"
              onClick={togglePlay}
              className="inline-flex h-14 w-14 items-center justify-center rounded-full bg-primary text-primary-foreground transition-transform active:scale-95"
              aria-label={isPlaying ? "Pause" : "Play"}
              aria-pressed={isPlaying}
            >
              {isPlaying ? <Pause className="h-7 w-7" /> : <Play className="h-7 w-7 fill-current" />}
            </button>

            <button
              type="button"
              onClick={skipForward}
              className="inline-flex h-12 w-12 items-center justify-center rounded-full bg-secondary text-secondary-foreground transition-transform active:scale-95"
              aria-label="Next"
            >
              <SkipForward className="h-6 w-6" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
