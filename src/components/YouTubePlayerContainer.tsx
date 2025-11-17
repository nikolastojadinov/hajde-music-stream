import { usePlayer } from "@/contexts/PlayerContext";
import { useIsMobile } from "@/hooks/use-mobile";

export const YouTubePlayerContainer = () => {
  const { isFullscreen, isPlayerVisible } = usePlayer();
  const isMobile = useIsMobile();

  if (!isPlayerVisible) return null;

  // Fixed minimal dimensions for mini player (200x200 - YouTube minimum)
  // On mobile, wrapper is smaller (110px) to match scaled iframe visual size
  const miniPlayerStyles = {
    bottom: 'calc(5rem + 12px)',
    left: '16px',
    transform: 'none',
    width: isMobile ? '110px' : '200px',
    height: isMobile ? '110px' : '200px',
  };

  // Fullscreen dimensions - responsive and proportional
  const fullscreenStyles = {
    top: '120px',
    left: '50%',
    transform: 'translateX(-50%)',
    width: 'min(896px, 90vw)',
    aspectRatio: '16/9',
    maxHeight: 'calc(100vh - 240px)',
  };

  // Mobile scale for mini player (55-60% visual size while maintaining 200x200 CSS pixels)
  const mobileScale = isMobile && !isFullscreen ? 0.55 : 1;
  const playerTransform = mobileScale !== 1 
    ? `scale(${mobileScale})` 
    : undefined;

  return (
    <div
      id="yt-player-wrapper"
      className="fixed transition-all duration-300 ease-in-out bg-black rounded-lg overflow-hidden"
      style={{
        zIndex: isFullscreen ? 55 : 31,
        ...(isFullscreen ? fullscreenStyles : miniPlayerStyles),
      }}
    >
      <div 
        id="yt-player" 
        style={{ 
          width: '100%', 
          height: '100%',
          transform: playerTransform,
          transformOrigin: 'top center'
        }} 
      />
    </div>
  );
};
