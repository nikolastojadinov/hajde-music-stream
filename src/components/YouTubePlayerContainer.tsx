import { usePlayer } from "@/contexts/PlayerContext";
import { useIsMobile } from "@/hooks/use-mobile";

export const YouTubePlayerContainer = () => {
  const { isFullscreen, isPlayerVisible } = usePlayer();
  const isMobile = useIsMobile();

  if (!isPlayerVisible) return null;

  // Mini player - mobile optimized with scale, desktop 200x200
  if (!isFullscreen) {
    // Mobile: wrapper 110px (scaled down from 200px with 0.55 scale)
    // Desktop: wrapper 200px (no scaling)
    const wrapperSize = isMobile ? '110px' : '200px';
    const playerTransform = isMobile ? 'scale(0.55)' : undefined;

    return (
      <div
        id="yt-player-wrapper"
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
        <style>{`
          #yt-player iframe {
            width: 200px !important;
            height: 200px !important;
          }
        `}</style>
      </div>
    );
  }

  // Fullscreen player - fills entire container with proper aspect ratio
  return (
    <div
      id="yt-player-wrapper"
      className="fixed transition-all duration-300 ease-in-out"
      style={{
        zIndex: 55,
        top: '120px',
        left: '50%',
        transform: 'translateX(-50%)',
        width: 'min(896px, 90vw)',
        height: 'auto',
      }}
    >
      {/* Aspect ratio container for 16:9 */}
      <div 
        style={{ 
          position: 'relative',
          width: '100%',
          paddingBottom: '56.25%', // 16:9 aspect ratio
          backgroundColor: '#000',
          borderRadius: '0.5rem',
          overflow: 'hidden',
        }}
      >
        <div 
          id="yt-player" 
          style={{ 
            position: 'absolute',
            top: 0,
            left: 0,
            width: '100%',
            height: '100%',
          }} 
        />
      </div>
      <style>{`
        #yt-player iframe {
          width: 100% !important;
          height: 100% !important;
        }
      `}</style>
    </div>
  );
};
};
