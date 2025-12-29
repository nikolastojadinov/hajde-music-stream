import { usePlayer } from "@/contexts/PlayerContext";
import { useIsMobile } from "@/hooks/use-mobile";

export const YouTubePlayerContainer = () => {
  const { isFullscreen, isPlayerVisible } = usePlayer();
  const isMobile = useIsMobile();

  if (!isPlayerVisible) return null;

  // Mini player - mobile optimized with scale, desktop 200x200
  // Uses id="yt-player" for YouTube API initialization
  if (!isFullscreen) {
    const wrapperSize = isMobile ? '110px' : '200px';

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
          overflow: 'hidden',
          borderRadius: '12px',
        }}
      >
        <div
          id="yt-player"
          style={{
            width: wrapperSize,
            height: wrapperSize,
            borderRadius: '12px',
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
        top: '96px',
        left: '50%',
        transform: 'translateX(-50%)',
        width: 'min(960px, 90vw)',
        aspectRatio: '16 / 9',
        maxWidth: '100%',
        overflow: 'hidden',
      }}
    >
      {/* Fullscreen dedicated wrapper - ensures iframe visibility */}
      <div
        className="youtube-wrapper fullscreen-yt-wrapper"
        style={{
          position: 'relative',
          width: '100%',
          height: '100%',
          background: 'linear-gradient(135deg, rgba(245,194,107,0.35), rgba(123,63,228,0.35))',
          borderRadius: '14px',
          padding: '1px',
          overflow: 'hidden',
        }}
      >
        <div
          style={{
            position: 'absolute',
            inset: '1px',
            borderRadius: '13px',
            background: 'rgba(20, 14, 30, 0.75)',
            backdropFilter: 'blur(18px)',
          }}
        />
        <div
          id="yt-player"
          className="fullscreen-youtube-player"
          style={{
            position: 'absolute',
            inset: 0,
            width: '100%',
            height: '100%',
            borderRadius: '13px',
          }}
        />
      </div>
    </div>
  );
};
