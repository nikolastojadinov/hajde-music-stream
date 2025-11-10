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
  const playerInitializedRef = useRef(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [volume, setVolumeState] = useState(70);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [videoId, setVideoId] = useState("dQw4w9WgXcQ");
  const [playerReady, setPlayerReady] = useState(false);

  useEffect(() => {
    // Sprečava višestruko pokretanje
    if (playerInitializedRef.current) {
      console.log("Player already initialized, skipping...");
      return;
    }

    console.log("Initializing YouTube player for the first time...");

    // Učitaj YouTube Iframe API
    if (!window.YT) {
      const tag = document.createElement("script");
      tag.src = "https://www.youtube.com/iframe_api";
      const firstScriptTag = document.getElementsByTagName("script")[0];
      firstScriptTag.parentNode?.insertBefore(tag, firstScriptTag);
    }

    // Inicijalizuj player kada je API spreman
    const initializePlayer = () => {
      if (playerInitializedRef.current) {
        console.log("Already initialized, aborting...");
        return;
      }

      if (window.YT && window.YT.Player) {
        // Sačekaj da se DOM učita
        const checkContainer = setInterval(() => {
          const container = document.getElementById("youtube-player-container");
          
          if (container) {
            clearInterval(checkContainer);
            console.log("Container found, creating player...");
            
            playerInitializedRef.current = true;
            
            playerRef.current = new window.YT.Player("youtube-player-container", {
              videoId: videoId,
              width: '100%',
              height: '100%',
              playerVars: {
                autoplay: 0,
                controls: 1,
                enablejsapi: 1,
                origin: window.location.origin,
                modestbranding: 1,
                rel: 0,
              },
              events: {
                onReady: (event: any) => {
                  console.log("✅ YouTube player ready!");
                  event.target.setVolume(volume);
                  setPlayerReady(true);
                },
                onStateChange: (event: any) => {
                  const states = ['unstarted', 'ended', 'playing', 'paused', 'buffering', 'cued'];
                  console.log("Player state:", states[event.data + 1] || event.data);
                  setIsPlaying(event.data === window.YT.PlayerState.PLAYING);
                },
                onError: (event: any) => {
                  console.error("YouTube player error:", event.data);
                },
              },
            });
          }
        }, 100);

        // Timeout nakon 5 sekundi
        setTimeout(() => clearInterval(checkContainer), 5000);
      }
    };

    if (window.YT && window.YT.Player) {
      initializePlayer();
    } else {
      window.onYouTubeIframeAPIReady = () => {
        console.log("YouTube API ready");
        initializePlayer();
      };
    }

    // Ažuriraj trenutno vreme i trajanje
    const interval = setInterval(() => {
      if (playerRef.current && playerRef.current.getCurrentTime) {
        try {
          setCurrentTime(playerRef.current.getCurrentTime());
          setDuration(playerRef.current.getDuration());
        } catch (e) {
          // Ignoriši greške
        }
      }
    }, 1000);

    return () => {
      clearInterval(interval);
      // NE uništavaj player - ostavi ga aktivnim
    };
  }, []); // Prazan dependency array - pokreće se samo jednom

  // Ažuriraj video kada se promeni videoId
  useEffect(() => {
    if (playerRef.current && playerRef.current.loadVideoById && playerReady) {
      console.log("Loading new video:", videoId);
      playerRef.current.loadVideoById(videoId);
    }
  }, [videoId, playerReady]);

  const togglePlay = () => {
    if (!playerRef.current) {
      console.log("Player not ready");
      return;
    }
    
    console.log("Toggle play, current state:", isPlaying);
    
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
      console.log("Skip forward to:", newTime);
    }
  };

  const skipBackward = (seconds: number = 10) => {
    if (playerRef.current && playerRef.current.getCurrentTime) {
      const newTime = Math.max(0, playerRef.current.getCurrentTime() - seconds);
      playerRef.current.seekTo(newTime, true);
      console.log("Skip backward to:", newTime);
    }
  };

  const setVolume = (newVolume: number) => {
    if (playerRef.current && playerRef.current.setVolume) {
      playerRef.current.setVolume(newVolume);
      setVolumeState(newVolume);
      console.log("Volume set to:", newVolume);
    }
  };

  const seekTo = (seconds: number) => {
    if (playerRef.current && playerRef.current.seekTo) {
      playerRef.current.seekTo(seconds, true);
      console.log("Seek to:", seconds);
    }
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
