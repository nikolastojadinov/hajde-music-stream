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
        <div className="relative rounded-3xl bg-[radial-gradient(circle_at_15%_20%,rgba(245,194,107,0.22),transparent_42%),radial-gradient(circle_at_82%_8%,rgba(123,63,228,0.26),transparent_44%)] p-[1px] shadow-[0_20px_60px_rgba(0,0,0,0.55)]">
          <div className="relative rounded-[1.1rem] bg-[rgba(8,6,14,0.88)] backdrop-blur-[18px] border border-white/8 overflow-hidden">
            <button
              onClick={() => setIsFullscreen(true)}
              className="absolute top-2 left-1/2 -translate-x-1/2 text-[#F5C26B] hover:text-[#ffd78a] transition-colors z-10 drop-shadow-[0_0_10px_rgba(245,194,107,0.25)]"
            >
              <ChevronUp className="w-5 h-5" />
            </button>

            <button
              onClick={handleClose}
              className="absolute top-2 right-2 text-[#8B86A3] hover:text-[#F3F1FF] transition-colors z-10"
            >
              <X className="w-5 h-5" />
            </button>

            <div className="flex items-center justify-between gap-3 px-4 pt-4 pb-3">
              <div className="flex items-center gap-3 flex-1 min-w-0">
                <div
                  className={`${isMobile ? "w-[110px] h-[110px]" : "w-[200px] h-[200px]"} flex-shrink-0 rounded-2xl bg-[radial-gradient(circle_at_50%_20%,rgba(245,194,107,0.12),transparent_46%),radial-gradient(circle_at_80%_10%,rgba(123,63,228,0.18),transparent_46%),rgba(10,8,18,0.9)] border border-white/10 shadow-[0_18px_32px_rgba(0,0,0,0.5),0_0_22px_rgba(245,194,107,0.2)] overflow-hidden`}
                />
                <div className="min-w-0 flex-1 hidden md:block">
                  <p className="font-semibold text-[#F5C26B] truncate drop-shadow-[0_4px_16px_rgba(245,194,107,0.28)]">{currentVideoTitle || "Purple Dreams"}</p>
                  <p className="text-sm text-[#C8C2DD] truncate">{currentVideoArtist || "Electronic Beats"}</p>
                </div>
              </div>

              <div className="flex items-center gap-4 flex-1 justify-center text-[#F5C26B]">
                <button onClick={skipBackward} className="h-11 w-11 rounded-full border border-[#F5C26B]/30 bg-white/5 hover:border-[#F5C26B]/60 hover:text-[#ffd78a] transition-colors shadow-[0_10px_26px_rgba(0,0,0,0.5)]">
                  <SkipBack className="w-6 h-6 mx-auto" />
                </button>

                <button
                  onClick={togglePlay}
                  className="pm-cta-button pm-cta-button--md flex items-center justify-center"
                >
                  {isPlaying ? <Pause className="w-6 h-6" /> : <Play className="w-6 h-6 fill-current ml-0.5" />}
                </button>

                <button onClick={skipForward} className="h-11 w-11 rounded-full border border-[#F5C26B]/30 bg-white/5 hover:border-[#F5C26B]/60 hover:text-[#ffd78a] transition-colors shadow-[0_10px_26px_rgba(0,0,0,0.5)]">
                  <SkipForward className="w-6 h-6 mx-auto" />
                </button>

                <AddToPlaylistButton
                  trackId={currentTrackId ?? undefined}
                  trackTitle={currentVideoTitle}
                  variant="ghost"
                  triggerClassName="pm-cta-button pm-cta-button--sm flex items-center justify-center"
                />

                <button
                  onClick={handleToggleLike}
                  disabled={likeDisabled}
                  className={`transition-colors ${isCurrentTrackLiked ? "text-[#F5C26B]" : "text-[#F5C26B] hover:text-[#ffd78a]"} ${likeDisabled ? "opacity-50 cursor-not-allowed" : ""}`}
                >
                  <Heart className={`w-6 h-6 ${isCurrentTrackLiked ? "fill-current" : ""}`} />
                </button>
              </div>

              <div className="hidden md:flex items-center gap-3 flex-1 justify-end text-[#C8C2DD]">
                <Volume2 className="w-5 h-5" />
                <Slider
                  value={[volume]}
                  max={100}
                  step={1}
                  className="w-28"
                  trackClassName="bg-[#130d1f]/80"
                  rangeClassName="bg-[linear-gradient(90deg,#F5C26B,#7B3FE4)]"
                  thumbClassName="h-4 w-4 bg-[#0c0814] border-[1.5px] border-[#F5C26B] shadow-[0_0_8px_rgba(245,194,107,0.35)]"
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
