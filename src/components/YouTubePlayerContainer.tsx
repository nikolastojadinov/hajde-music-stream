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
  // Only apply transform to mini-player, not fullscreen
  const playerTransform = (isMobile && !isFullscreen) ? `scale(0.55)` : undefined;

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
        className={isFullscreen ? 'w-full h-full' : ''}
        style={{ 
          width: isFullscreen ? '100%' : '200px',
          height: isFullscreen ? '100%' : '200px',
          ...(playerTransform && { 
            transform: playerTransform,
            transformOrigin: 'top left'
          })
        }} 
      />
      <style>{`
        ${isFullscreen ? `
          #yt-player iframe {
            width: 100% !important;
            height: 100% !important;
          }
        ` : `
          #yt-player iframe {
            width: 200px !important;
            height: 200px !important;
          }
        `}
      `}</style>
    </div>
  );
};
