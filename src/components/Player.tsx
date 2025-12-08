import { useEffect, useState } from "react";
import { Slider } from "@/components/ui/slider";
import AddToPlaylistButton from "@/components/AddToPlaylistButton";
import { usePlayer } from "@/contexts/PlayerContext";
import { useIsMobile } from "@/hooks/use-mobile";
import useLikes from "@/hooks/useLikes";

type AdaptiveLayout = {
  iframeSize: number;
  scale: number;
};

function useAdaptiveLayout(isMobile: boolean): AdaptiveLayout {
  const [layout, setLayout] = useState<AdaptiveLayout>({
    iframeSize: isMobile ? 110 : 200,
    scale: 1,
  });

  useEffect(() => {
    if (typeof window === "undefined") return;

    const dpr = window.devicePixelRatio || 1;
    const minPhysical = 200;
    const cssMin = Math.ceil(minPhysical / dpr);

    const baseMobile = 110;
    const baseDesktop = 200;
    const base = isMobile ? baseMobile : baseDesktop;

    const iframeSize = isMobile ? Math.max(cssMin, 80) : baseDesktop;
    const rawScale = iframeSize / base;
    const scale = Math.min(Math.max(rawScale, 0.7), 1.4);

    setLayout({ iframeSize, scale });
  }, [isMobile]);

  return layout;
}

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

  const { iframeSize, scale } = useAdaptiveLayout(isMobile);
  const progressPercentage = duration > 0 ? (currentTime / duration) * 100 : 0;

  const handleClose = () => {
    if (isPlaying) togglePlay();
    setIsPlayerVisible(false);
  };

  const handleVolumeChange = (values: number[]) => updateVolume(values[0]);
  const handleProgressChange = (values: number[]) => {
    if (!duration) return;
    seekTo((values[0] / 100) * duration);
  };

  const handleToggleLike = () => {
    if (!currentTrackId) return;
    toggleTrackLike(currentTrackId);
  };

  if (!isPlayerVisible) return null;

  if (isFullscreen) {
    return (
      <div className="fixed inset-0 bg-background z-50 flex flex-col">
        <div className="flex items-center justify-between p-4 border-b border-border">
          <button
            onClick={() => setIsFullscreen(false)}
            className="text-foreground hover:text-primary"
          >
            <ChevronDown className="w-6 h-6" />
          </button>

          <button
            onClick={handleClose}
            className="text-muted-foreground hover:text-foreground"
          >
            <X className="w-6 h-6" />
          </button>
        </div>

        <div className="flex-1 flex flex-col items-center overflow-y-auto p-4 pt-8">
          <div
            className="w-full max-w-4xl mb-8"
            style={{
              aspectRatio: "16 / 9",
              minHeight: "300px",
              maxHeight: "70vh",
            }}
          />

          <div className="w-full max-w-md text-center mb-6">
            <h2 className="text-2xl font-bold mb-1 text-foreground">
              {currentVideoTitle}
            </h2>
            <p className="text-muted-foreground">{currentVideoArtist}</p>
          </div>

          <div className="w-full max-w-md mb-6">
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

          <div className="flex items-center gap-6 mb-6">
            <button className="text-muted-foreground hover:text-foreground">
              <Shuffle className="w-5 h-5" />
            </button>

            <button
              onClick={skipBackward}
              className="text-foreground hover:text-primary"
            >
              <SkipBack className="w-7 h-7" />
            </button>

            <button
              onClick={togglePlay}
              className="w-14 h-14 bg-primary rounded-full flex items-center justify-center text-background hover:scale-105"
            >
              {isPlaying ? (
                <Pause className="w-7 h-7" />
              ) : (
                <Play className="w-7 h-7 fill-current ml-1" />
              )}
            </button>

            <button
              onClick={skipForward}
              className="text-foreground hover:text-primary"
            >
              <SkipForward className="w-7 h-7" />
            </button>

            <button className="text-muted-foreground hover:text-foreground">
              <Repeat className="w-5 h-5" />
            </button>
          </div>

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
                className={`${
                  isCurrentTrackLiked
                    ? "text-primary"
                    : "text-muted-foreground hover:text-primary"
                } ${likeDisabled ? "opacity-50 cursor-not-allowed" : ""}`}
              >
                <Heart
                  className={isCurrentTrackLiked ? "fill-current" : ""}
                />
              </button>
            </div>

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

  const basePlay = 48;
  const baseIcon = 24;
  const baseSmall = 20;

  const playSize = basePlay * scale;
  const iconSize = baseIcon * scale;
  const smallIcon = baseSmall * scale;

  const padY = (isMobile ? 8 : 12) * scale;
  const topOffset = 6 * scale;
  const gapControls = (isMobile ? 14 : 18) * scale;
  const gapLeft = (isMobile ? 10 : 14) * scale;

  return (
    <div className="fixed bottom-20 md:bottom-0 left-0 right-0 bg-card/95 backdrop-blur-md border-t border-border z-30">
      <div className="relative" style={{ paddingTop: padY }}>
        <div className="absolute bottom-2 right-3 z-20 md:hidden">
          <AddToPlaylistButton
            trackId={currentTrackId ?? undefined}
            trackTitle={currentVideoTitle}
            triggerClassName="bg-primary text-primary-foreground shadow-lg"
          />
        </div>

        <button
          onClick={() => setIsFullscreen(true)}
          className="absolute left-1/2 -translate-x-1/2 text-muted-foreground hover:text-foreground z-10"
          style={{ top: topOffset }}
        >
          <ChevronUp style={{ width: smallIcon, height: smallIcon }} />
        </button>

        <button
          onClick={handleClose}
          className="absolute right-2 text-muted-foreground hover:text-foreground z-10"
          style={{ top: topOffset }}
        >
          <X style={{ width: smallIcon, height: smallIcon }} />
        </button>

        <div
          className="flex items-center justify-between max-w-screen-2xl mx-auto px-4"
          style={{
            paddingTop: padY,
            paddingBottom: padY / 2,
          }}
        >
          <div className="flex items-center flex-1 min-w-0">
            <div
              className="flex-shrink-0 bg-secondary/20 rounded-lg"
              style={{
                width: iframeSize,
                height: iframeSize,
                marginRight: gapLeft,
              }}
            />

            <div className="hidden md:block min-w-0 flex-1">
              <p className="font-semibold text-foreground truncate">
                {currentVideoTitle || "Purple Dreams"}
              </p>
              <p className="text-sm text-muted-foreground truncate">
                {currentVideoArtist || "Electronic Beats"}
              </p>
            </div>
          </div>

          <div
            className="flex items-center flex-1 justify-center"
            style={{ columnGap: gapControls }}
          >
            <button
              onClick={skipBackward}
              className="text-foreground hover:text-primary"
            >
              <SkipBack style={{ width: iconSize, height: iconSize }} />
            </button>

            <button
              onClick={togglePlay}
              className="bg-primary rounded-full flex items-center justify-center text-background hover:scale-105"
              style={{ width: playSize, height: playSize }}
            >
              {isPlaying ? (
                <Pause style={{ width: iconSize, height: iconSize }} />
              ) : (
                <Play
                  className="fill-current"
                  style={{ width: iconSize, height: iconSize, marginLeft: 1 }}
                />
              )}
            </button>

            <button
              onClick={skipForward}
              className="text-foreground hover:text-primary"
            >
              <SkipForward style={{ width: iconSize, height: iconSize }} />
            </button>

            <button
              onClick={handleToggleLike}
              disabled={likeDisabled}
              className={`${
                isCurrentTrackLiked
                  ? "text-primary"
                  : "text-muted-foreground hover:text-primary"
              } ${likeDisabled ? "opacity-50 cursor-not-allowed" : ""}`}
            >
              <Heart
                className={isCurrentTrackLiked ? "fill-current" : ""}
                style={{ width: iconSize, height: iconSize }}
              />
            </button>
          </div>

          <div className="hidden md:flex items-center flex-1 justify-end">
            <AddToPlaylistButton
              trackId={currentTrackId ?? undefined}
              trackTitle={currentVideoTitle}
              variant="ghost"
              triggerClassName="text-muted-foreground hover:text-primary"
            />

            <div className="ml-3 flex items-center gap-2">
              <Volume2
                className="text-muted-foreground"
                style={{ width: smallIcon, height: smallIcon }}
              />

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
    </div>
  );
};

export default Player;