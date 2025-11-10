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
  togglePlay: () => void;
  skipForward: () => void;
  skipBackward: () => void;
  setVolume: (volume: number) => void;
  seekTo: (seconds: number) => void;
  formatTime: (seconds: number) => string;
  setIsFullscreen: (fullscreen: boolean) => void;
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
  const [playerReady, setPlayerReady] = useState(false);
  const initAttempted = useRef(false);

  useEffect(() => {
    if (initAttempted.current) return;
    initAttempted.current = true;

    // Učitaj YouTube API
    const loadYouTubeAPI = () => {
      if (!window.YT) {
        const tag = document.createElement("script");
        tag.src = "https://www.youtube.com/iframe_api";
        document.body.appendChild(tag);
      }
    };

    loadYouTubeAPI();

    // Funkcija za kreiranje playera
    const createPlayer = () => {
      const container = document.getElementById("yt-player");
      if (!container || playerRef.current) return;

      try {
        playerRef.current = new window.YT.Player("yt-player", {
          videoId: "dQw4w9WgXcQ",
          playerVars: {
            autoplay: 0,
            controls: 1,
            modestbranding: 1,
            rel: 0,
          },
          events: {
            onReady: (event: any) => {
              console.log("Player ready");
              event.target.setVolume(volume);
              setPlayerReady(true);
            },
            onStateChange: (event: any) => {
              setIsPlaying(event.data === 1); // 1 = playing
            },
          },
        });
      } catch (error) {
        console.error("Error creating player:", error);
      }
    };

    // Čekaj da se API učita
    if (window.YT && window.YT.Player) {
      setTimeout(createPlayer, 500);
    } else {
      window.onYouTubeIframeAPIReady = () => {
        setTimeout(createPlayer, 500);
      };
    }

    // Ažuriraj vreme
    const interval = setInterval(() => {
      if (playerRef.current && playerRef.current.getCurrentTime) {
        try {
          setCurrentTime(playerRef.current.getCurrentTime() || 0);
          setDuration(playerRef.current.getDuration() || 0);
        } catch (e) {
          // ignore
        }
      }
    }, 1000);

    return () => clearInterval(interval);
  }, []);

  const togglePlay = () => {
    if (!playerRef.current) return;
    
    if (isPlaying) {
      playerRef.current.pauseVideo();
    } else {
      playerRef.current.playVideo();
    }
  };

  const skipForward = () => {
    if (!playerRef.current) return;
    const currentTime = playerRef.current.getCurrentTime();
    playerRef.current.seekTo(currentTime + 10, true);
  };

  const skipBackward = () => {
    if (!playerRef.current) return;
    const currentTime = playerRef.current.getCurrentTime();
    playerRef.current.seekTo(Math.max(0, currentTime - 10), true);
  };

  const setVolume = (newVolume: number) => {
    if (!playerRef.current) return;
    playerRef.current.setVolume(newVolume);
    setVolumeState(newVolume);
  };

  const seekTo = (seconds: number) => {
    if (!playerRef.current) return;
    playerRef.current.seekTo(seconds, true);
  };

  const formatTime = (seconds: number): string => {
    if (!seconds || isNaN(seconds)) return "0:00";
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
        togglePlay,
        skipForward,
        skipBackward,
        setVolume,
        seekTo,
        formatTime,
        setIsFullscreen,
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
