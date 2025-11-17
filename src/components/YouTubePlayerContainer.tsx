import { usePlayer } from "@/contexts/PlayerContext";
import { useIsMobile } from "@/hooks/use-mobile";

export const YouTubePlayerContainer = () => {
  const { isFullscreen, isPlayerVisible } = usePlayer();
  const isMobile = useIsMobile();

  if (!isPlayerVisible) return null;

  // Wrapper dimensions match visual size of scaled iframe
  // On mobile: 110px (200 * 0.55 scale) to eliminate black background
  // On desktop: 200px (no scaling)
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

  // Mobile scale for iframe (55% visual size while maintaining 200x200 CSS pixels)
  const mobileScale = isMobile && !isFullscreen ? 0.55 : 1;
  const playerTransform = mobileScale !== 1 
    ? `scale(${mobileScale})` 
    : undefined;

  // Fullscreen player dimensions
  const playerWidth = isFullscreen ? '896px' : '200px';
  const playerHeight = isFullscreen ? '504px' : '200px'; // 896 * 9/16 = 504

  return (
    <div
      id="yt-player-wrapper"
      className="fixed transition-all duration-300 ease-in-out bg-black rounded-lg"
      style={{
        zIndex: isFullscreen ? 55 : 31,
        overflow: isMobile && !isFullscreen ? 'visible' : 'hidden',
        ...(isFullscreen ? fullscreenStyles : miniPlayerStyles),
      }}
    >
      <div 
        id="yt-player" 
        style={{ 
          width: playerWidth,
          height: playerHeight,
          maxWidth: '100%',
          maxHeight: '100%',
          margin: '0 auto',
          transform: playerTransform,
          transformOrigin: playerTransform ? 'top left' : undefined
        }} 
      />
    </div>
  );
};
