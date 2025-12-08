import React, { useEffect, useRef, useState } from "react";
import { usePlayer } from "@/contexts/PlayerContext";
import { useIsMobile } from "@/hooks/use-mobile";

type AdaptiveLayout = {
  iframeSize: number;
  scale: number;
};

function useAdaptiveLayout(isMobile: boolean): AdaptiveLayout {
  const [layout, setLayout] = useState<AdaptiveLayout>({
    iframeSize: isMobile ? 110 : 200,
    scale: 1,
  });

  useEffect(() => {
    if (typeof window === "undefined") return;

    const dpr = window.devicePixelRatio || 1;
    const minPhysical = 200;
    const cssMin = Math.ceil(minPhysical / dpr);

    const baseMobile = 110;
    const baseDesktop = 200;
    const base = isMobile ? baseMobile : baseDesktop;

    const iframeSize = isMobile ? Math.max(cssMin, 80) : baseDesktop;
    const rawScale = iframeSize / base;
    const scale = Math.min(Math.max(rawScale, 0.7), 1.4);

    setLayout({ iframeSize, scale });
  }, [isMobile]);

  return layout;
}

export const YouTubePlayerContainer = () => {
  const {
    isFullscreen,
    isPlayerVisible,
    currentVideoId,
    registerYouTubePlayerInstance,
  } = usePlayer();

  const isMobile = useIsMobile();
  const { iframeSize } = useAdaptiveLayout(isMobile);
  const playerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!playerRef.current) return;
    if (!currentVideoId) return;

    registerYouTubePlayerInstance(playerRef.current);
  }, [currentVideoId, registerYouTubePlayerInstance]);

  if (!isPlayerVisible) return null;

  if (!isFullscreen) {
    return (
      <div
        id="yt-player-wrapper-mini"
        className="fixed bg-black rounded-lg"
        style={{
          zIndex: 40,
          bottom: "calc(5rem + 12px)",
          left: "16px",
          width: `${iframeSize}px`,
          height: `${iframeSize}px`,
          overflow: "hidden",
        }}
      >
        <div
          id="yt-player"
          ref={playerRef}
          style={{
            width: "100%",
            height: "100%",
          }}
        />
      </div>
    );
  }

  return (
    <div
      id="yt-player-wrapper-fullscreen"
      className="fixed transition-all duration-300 ease-in-out"
      style={{
        zIndex: 55,
        top: "80px",
        left: "50%",
        transform: "translateX(-50%)",
        width: "min(896px, 90vw)",
        maxWidth: "100%",
      }}
    >
      <div
        className="youtube-wrapper fullscreen-yt-wrapper"
        style={{
          position: "relative",
          width: "100%",
          minHeight: "220px",
          backgroundColor: "#000",
          borderRadius: "0.5rem",
          overflow: "visible",
          display: "flex",
          justifyContent: "center",
          alignItems: "center",
        }}
      >
        <div
          id="yt-player"
          ref={playerRef}
          className="fullscreen-youtube-player"
          style={{
            width: "100%",
            height: "100%",
            minHeight: "220px",
          }}
        />
      </div>
    </div>
  );
};
