import { usePlayer } from "@/contexts/PlayerContext";

export const YouTubePlayerContainer = () => {
  const { isFullscreen, isPlayerVisible } = usePlayer();

  if (!isPlayerVisible) return null;

  // Fixed minimal dimensions for mini player (200x200 - YouTube minimum)
  const miniPlayerStyles = {
    bottom: 'calc(5rem + 12px)',
    left: '16px',
    transform: 'none',
    width: '200px',
    height: '200px',
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
