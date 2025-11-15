import { usePlayer } from "@/contexts/PlayerContext";
import { useIsMobile } from "@/hooks/use-mobile";

export const YouTubePlayerContainer = () => {
  const { isFullscreen, isPlayerVisible } = usePlayer();
  const isMobile = useIsMobile();

  if (!isPlayerVisible) return null;

  // Mini player wrapper dimensions - smaller on mobile to match YouTube app
  const miniPlayerWrapperStyles = {
    bottom: 'calc(5rem + 12px)',
    left: '16px',
    width: isMobile ? '120px' : '200px',
    height: isMobile ? '120px' : '200px',
  };

  // Inner iframe stays at 200x200 (YouTube minimum) but scales down visually on mobile
  const miniPlayerIframeStyles = isMobile
    ? {
        width: '200px',
        height: '200px',
        transform: 'scale(0.55)',
        transformOrigin: 'top left',
      }
    : {
        width: '100%',
        height: '100%',
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

  return (
    <div
      id="yt-player-wrapper"
      className="fixed transition-all duration-300 ease-in-out bg-black rounded-lg overflow-hidden"
      style={{
        zIndex: isFullscreen ? 55 : 31,
        ...(isFullscreen ? fullscreenStyles : miniPlayerWrapperStyles),
      }}
    >
      <div 
        id="yt-player" 
        style={isFullscreen ? { width: '100%', height: '100%' } : miniPlayerIframeStyles} 
      />
    </div>
  );
};
