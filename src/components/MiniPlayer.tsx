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
    <div className="fixed bottom-20 md:bottom-0 left-0 right-0 z-30 px-3 md:px-4">
      <div className="mx-auto max-w-screen-2xl">
          <div className="relative rounded-2xl bg-gradient-to-r from-[#F5C26B]/35 to-[#7B3FE4]/35 p-[1px] shadow-[0_20px_60px_rgba(0,0,0,0.45)]">
          <div className="relative rounded-[1rem] bg-[rgba(20,14,30,0.75)] backdrop-blur-[16px] border border-white/10 overflow-hidden">
            <div className="absolute bottom-2 right-3 z-20 md:hidden">
              <AddToPlaylistButton
                trackId={currentTrackId ?? undefined}
                trackTitle={currentVideoTitle}
                triggerClassName="pm-cta-button pm-cta-button--sm text-[#0B0814]"
              />
            </div>

            <button
              onClick={() => setIsFullscreen(true)}
              className="absolute top-2 left-1/2 -translate-x-1/2 text-[#CFA85B] hover:text-[#F6C66D] transition-colors z-10"
            >
              <ChevronUp className="w-5 h-5" />
            </button>

            <button
              onClick={handleClose}
              className="absolute top-2 right-2 text-[#8B86A3] hover:text-[#F3F1FF] transition-colors z-10"
            >
              <X className="w-5 h-5" />
            </button>

            <div className="flex items-center justify-between gap-2 px-4 pt-3 pb-3">
              <div className="flex items-center gap-2 flex-1 min-w-0">
                <div
                  className={`${isMobile ? "w-[110px] h-[110px]" : "w-[200px] h-[200px]"} flex-shrink-0 rounded-xl bg-[rgba(20,14,30,0.65)] shadow-[0_18px_32px_rgba(0,0,0,0.45)] border border-white/10 overflow-hidden`}
                />
                <div className="min-w-0 flex-1 hidden md:block">
                  <p className="font-semibold text-[#F6C66D] truncate drop-shadow-sm">{currentVideoTitle || "Purple Dreams"}</p>
                  <p className="text-sm text-[#B7B2CC] truncate">{currentVideoArtist || "Electronic Beats"}</p>
                </div>
              </div>

              <div className="flex items-center gap-4 flex-1 justify-center">
                <button onClick={skipBackward} className="text-[#F5C26B] hover:text-[#F08CFF] transition-colors">
                  <SkipBack className="w-6 h-6" />
                </button>

                <button
                  onClick={togglePlay}
                  className="pm-cta-button pm-cta-button--md flex items-center justify-center"
                >
                  {isPlaying ? <Pause className="w-6 h-6" /> : <Play className="w-6 h-6 fill-current ml-0.5" />}
                </button>

                <button onClick={skipForward} className="text-[#F5C26B] hover:text-[#F08CFF] transition-colors">
                  <SkipForward className="w-6 h-6" />
                </button>

                <button
                  onClick={handleToggleLike}
                  disabled={likeDisabled}
                  className={`transition-colors ${isCurrentTrackLiked ? "text-[#F08CFF]" : "text-[#F5C26B] hover:text-[#F08CFF]"} ${likeDisabled ? "opacity-50 cursor-not-allowed" : ""}`}
                >
                  <Heart className={`w-6 h-6 ${isCurrentTrackLiked ? "fill-current" : ""}`} />
                </button>
              </div>

              <div className="hidden md:flex items-center gap-2 flex-1 justify-end">
                <AddToPlaylistButton
                  trackId={currentTrackId ?? undefined}
                  trackTitle={currentVideoTitle}
                  variant="ghost"
                  triggerClassName="pm-cta-button pm-cta-button--sm text-[#0B0814]"
                />
                <Volume2 className="w-5 h-5 text-[#B7B2CC]" />
                <Slider
                  value={[volume]}
                  max={100}
                  step={1}
                  className="w-24 premium-slider"
                  trackClassName="bg-[#1d1230]"
                  rangeClassName="bg-gradient-to-r from-[#F5C26B] to-[#F08CFF]"
                  thumbClassName="h-4 w-4 bg-[#7B3FE4] border-2 border-[#F5C26B]"
                  onValueChange={handleVolumeChange}
                />
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default MiniPlayer;
