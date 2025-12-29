import { usePlayer } from "@/contexts/PlayerContext";
import { useIsMobile } from "@/hooks/use-mobile";

export const YouTubePlayerContainer = () => {
  const { isFullscreen, isPlayerVisible } = usePlayer();
  const isMobile = useIsMobile();

  if (!isPlayerVisible) return null;

  const miniSize = isMobile ? 110 : 200;
  const wrapperStyles = isFullscreen
    ? {
        zIndex: 55,
        position: 'fixed' as const,
        top: '92px',
        left: '50%',
        transform: 'translateX(-50%)',
        width: 'min(960px, 90vw)',
        aspectRatio: '16 / 9',
      }
    : {
        zIndex: 31,
        position: 'fixed' as const,
        bottom: 'calc(5rem + 12px)',
        left: '16px',
        width: `${miniSize}px`,
        height: `${miniSize}px`,
      };

  return (
    <div
      id={isFullscreen ? 'yt-player-wrapper-fullscreen' : 'yt-player-wrapper-mini'}
      className={`yt-player-shell ${isFullscreen ? 'is-fullscreen' : 'is-mini'}`}
      style={wrapperStyles}
    >
      <div className="yt-player-frame">
        <div id="yt-player" className="yt-player-node" />
      </div>
    </div>
  );
};
