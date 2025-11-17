import { usePlayer } from "@/contexts/PlayerContext";
import { useIsMobile } from "@/hooks/use-mobile";

export const YouTubePlayerContainer = () => {
  const { isFullscreen, isPlayerVisible } = usePlayer();
  const isMobile = useIsMobile();

  if (!isPlayerVisible) return null;

  // Mini player - mobile optimized with scale, desktop 200x200
  // Uses id="yt-player" for YouTube API initialization
  if (!isFullscreen) {
    // Mobile: wrapper 110px (scaled down from 200px with 0.55 scale)
    // Desktop: wrapper 200px (no scaling)
    const wrapperSize = isMobile ? '110px' : '200px';
    const playerTransform = isMobile ? 'scale(0.55)' : undefined;

    return (
      <div
        id="yt-player-wrapper-mini"
        className="fixed transition-all duration-300 ease-in-out bg-black rounded-lg"
        style={{
          zIndex: 31,
          bottom: 'calc(5rem + 12px)',
          left: '16px',
          width: wrapperSize,
          height: wrapperSize,
          overflow: isMobile ? 'visible' : 'hidden',
        }}
      >
        <div 
          id="yt-player" 
          style={{ 
            width: '200px',
            height: '200px',
            ...(playerTransform && { 
              transform: playerTransform,
              transformOrigin: 'top left'
            })
          }} 
        />
      </div>
    );
  }

  // Fullscreen player - fills entire container with proper aspect ratio
  // Uses id="yt-player" for YouTube API initialization when in fullscreen mode
  return (
    <div
      id="yt-player-wrapper-fullscreen"
      className="fullscreen-player fixed transition-all duration-300 ease-in-out"
      style={{
        zIndex: 55,
        top: '80px',
        left: '50%',
        transform: 'translateX(-50%)',
        width: 'min(896px, 90vw)',
        maxWidth: '100%',
      }}
    >
      {/* Fullscreen dedicated wrapper - ensures iframe visibility */}
      <div 
        className="youtube-wrapper fullscreen-yt-wrapper"
        style={{ 
          position: 'relative',
          width: '100%',
          minHeight: '220px',
          backgroundColor: '#000',
          borderRadius: '0.5rem',
          overflow: 'visible',
          display: 'flex',
          justifyContent: 'center',
          alignItems: 'center',
        }}
      >
        <div 
          id="yt-player" 
          className="fullscreen-youtube-player"
          style={{ 
            width: '100%',
            height: '100%',
            minHeight: '220px',
          }} 
        />
      </div>
    </div>
  );
};
