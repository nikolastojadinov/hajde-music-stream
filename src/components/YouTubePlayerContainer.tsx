import { usePlayer } from "@/contexts/PlayerContext";
import { useState, useEffect } from "react";

export const YouTubePlayerContainer = () => {
  const { isFullscreen, isPlayerVisible } = usePlayer();
  const [isMobile, setIsMobile] = useState(false);
  const [scaleFactor, setScaleFactor] = useState(1);

  // Detect mobile device and calculate PPI scale factor
  useEffect(() => {
    const updateDimensions = () => {
      const width = window.innerWidth;
      const mobile = width < 900;
      setIsMobile(mobile);

      if (mobile) {
        const dpr = window.devicePixelRatio || 1;
        // Scale based on PPI breakpoints
        let factor = 1;
        if (dpr >= 3.0) {
          factor = 1.3; // +30% for high-end devices
        } else if (dpr >= 2.0) {
          factor = 1.2; // +20% for retina displays
        } else if (dpr >= 1.5) {
          factor = 1.1; // +10% for mid-range displays
        }
        setScaleFactor(factor);
      } else {
        setScaleFactor(1); // No scaling on desktop/tablet
      }
    };

    updateDimensions();
    window.addEventListener('resize', updateDimensions);
    return () => window.removeEventListener('resize', updateDimensions);
  }, []);

  if (!isPlayerVisible) return null;

  // Calculate scaled dimensions for mini player on mobile
  const baseMiniSize = 200; // YouTube minimum
  const scaledMiniSize = isMobile ? Math.max(200, Math.floor(baseMiniSize * scaleFactor)) : baseMiniSize;

  // Fixed minimal dimensions for mini player (200x200 - YouTube minimum)
  const miniPlayerStyles = {
    bottom: 'calc(5rem + 12px)',
    left: '16px',
    transform: 'none',
    width: `${scaledMiniSize}px`,
    height: `${scaledMiniSize}px`,
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
        ...(isFullscreen ? fullscreenStyles : miniPlayerStyles),
      }}
    >
      <div id="yt-player" style={{ width: '100%', height: '100%' }} />
    </div>
  );
};
