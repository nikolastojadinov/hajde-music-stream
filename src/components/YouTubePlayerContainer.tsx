import { usePlayer } from "@/contexts/PlayerContext";

export const YouTubePlayerContainer = () => {
  const { isFullscreen, isPlayerVisible } = usePlayer();

  if (!isPlayerVisible) return null;

  // Responsive dimensions for mini player
  const getMiniPlayerStyles = () => {
    // Mobile: 200x200 (minimum for YouTube)
    // Tablet: 280x280
    // Desktop: 360x360
    const width = window.innerWidth >= 1024 ? '360px' : window.innerWidth >= 640 ? '280px' : '200px';
    const height = window.innerWidth >= 1024 ? '360px' : window.innerWidth >= 640 ? '280px' : '200px';
    
    return {
      bottom: 'calc(5rem + 12px)',
      left: '16px',
      transform: 'none',
      width,
      height,
    };
  };

  // Fullscreen dimensions - responsive and proportional
  const getFullscreenStyles = () => {
    return {
      top: '120px',
      left: '50%',
      transform: 'translateX(-50%)',
      width: 'min(896px, 90vw)',
      aspectRatio: '16/9',
      maxHeight: 'calc(100vh - 240px)', // Ensures it doesn't overflow
    };
  };

  return (
    <div
      id="yt-player-wrapper"
      className="fixed transition-all duration-300 ease-in-out bg-black rounded-lg overflow-hidden"
      style={{
        zIndex: isFullscreen ? 55 : 31,
        ...(isFullscreen ? getFullscreenStyles() : getMiniPlayerStyles()),
      }}
    >
      <div id="yt-player" style={{ width: '100%', height: '100%' }} />
    </div>
  );
};
