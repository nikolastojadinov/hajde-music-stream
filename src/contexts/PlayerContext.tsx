import React, { createContext, useContext, useState, useRef, useEffect } from "react";

declare global {
  interface Window {
    YT: any;
    onYouTubeIframeAPIReady: () => void;
  }
}

type PlayerContextType = {
  isPlaying: boolean;
  volume: number;
  currentTime: number;
  duration: number;
  isFullscreen: boolean;
  videoId: string;
  togglePlay: () => void;
  skipForward: (seconds?: number) => void;
  skipBackward: (seconds?: number) => void;
  setVolume: (volume: number) => void;
  seekTo: (seconds: number) => void;
  formatTime: (seconds: number) => string;
  setIsFullscreen: (fullscreen: boolean) => void;
  setVideoId: (id: string) => void;
  playerReady: boolean;
};

const PlayerContext = createContext<PlayerContextType | undefined>(undefined);

export const PlayerProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const playerRef = useRef<any>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [volume, setVolumeState] = useState(70);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [videoId, setVideoId] = useState("dQw4w9WgXcQ");
  const [playerReady, setPlayerReady] = useState(false);

  useEffect(() => {
    // Učitaj YouTube Iframe API
    if (!window.YT) {
      const tag = document.createElement("script");
      tag.src = "https://www.youtube.com/iframe_api";
      const firstScriptTag = document.getElementsByTagName("script")[0];
      firstScriptTag.parentNode?.insertBefore(tag, firstScriptTag);
    }

    // Inicijalizuj player kada je API spreman
    const initializePlayer = () => {
      if (window.YT && window.YT.Player) {
        const container = document.getElementById("youtube-player-container");
        if (container) {
          playerRef.current = new window.YT.Player("youtube-player-container", {
            videoId: videoId,
            playerVars: {
              autoplay: 0,
              controls: 1,
              enablejsapi: 1,
              origin: window.location.origin,
            },
            events: {
              onReady: (event: any) => {
                console.log("YouTube player ready");
                event.target.setVolume(volume);
                setPlayerReady(true);
              },
              onStateChange: (event: any) => {
                setIsPlaying(event.data === window.YT.PlayerState.PLAYING);
              },
            },
          });
        }
      }
    };

    if (window.YT && window.YT.Player) {
      initializePlayer();
    } else {
      window.onYouTubeIframeAPIReady = initializePlayer;
    }

    // Ažuriraj trenutno vreme i trajanje
    const interval = setInterval(() => {
      if (playerRef.current && playerRef.current.getCurrentTime) {
        setCurrentTime(playerRef.current.getCurrentTime());
        setDuration(playerRef.current.getDuration());
      }
    }, 1000);

    return () => {
      clearInterval(interval);
      if (playerRef.current && playerRef.current.destroy) {
        playerRef.current.destroy();
      }
    };
  }, []);

  // Ažuriraj video kada se promeni videoId
  useEffect(() => {
    if (playerRef.current && playerRef.current.loadVideoById && playerReady) {
      playerRef.current.loadVideoById(videoId);
    }
  }, [videoId, playerReady]);

  const togglePlay = () => {
    if (!playerRef.current) return;
    
    if (isPlaying) {
      playerRef.current.pauseVideo();
    } else {
      playerRef.current.playVideo();
    }
  };

  const skipForward = (seconds: number = 10) => {
    if (playerRef.current && playerRef.current.getCurrentTime) {
      const newTime = playerRef.current.getCurrentTime() + seconds;
      playerRef.current.seekTo(newTime, true);
    }
  };

  const skipBackward = (seconds: number = 10) => {
    if (playerRef.current && playerRef.current.getCurrentTime) {
      const newTime = Math.max(0, playerRef.current.getCurrentTime() - seconds);
      playerRef.current.seekTo(newTime, true);
    }
  };

  const setVolume = (newVolume: number) => {
    if (playerRef.current && playerRef.current.setVolume) {
      playerRef.current.setVolume(newVolume);
      setVolumeState(newVolume);
    }
  };

  const seekTo = (seconds: number) => {
    if (playerRef.current && playerRef.current.seekTo) {
      playerRef.current.seekTo(seconds, true);
    }
  };

  const formatTime = (seconds: number): string => {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, "0")}`;
  };

  return (
    <PlayerContext.Provider
      value={{
        isPlaying,
        volume,
        currentTime,
        duration,
        isFullscreen,
        videoId,
        togglePlay,
        skipForward,
        skipBackward,
        setVolume,
        seekTo,
        formatTime,
        setIsFullscreen,
        setVideoId,
        playerReady,
      }}
    >
      {children}
    </PlayerContext.Provider>
  );
};

export const usePlayer = () => {
  const context = useContext(PlayerContext);
  if (!context) {
    throw new Error("usePlayer must be used within PlayerProvider");
  }
  return context;
};
