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
  currentVideoTitle: string;
  currentVideoArtist: string;
  isLiked: boolean;
  togglePlay: () => void;
  skipForward: () => void;
  skipBackward: () => void;
  setVolume: (volume: number) => void;
  seekTo: (seconds: number) => void;
  formatTime: (seconds: number) => string;
  setIsFullscreen: (fullscreen: boolean) => void;
  toggleLike: () => void;
  playerReady: boolean;
};

const playlist = [
  { id: "dQw4w9WgXcQ", title: "Rick Astley - Never Gonna Give You Up", artist: "Rick Astley" },
  { id: "9bZkp7q19f0", title: "PSY - Gangnam Style", artist: "PSY" },
  { id: "kJQP7kiw5Fk", title: "Luis Fonsi - Despacito", artist: "Luis Fonsi ft. Daddy Yankee" },
  { id: "RgKAFK5djSk", title: "Wiz Khalifa - See You Again", artist: "Wiz Khalifa ft. Charlie Puth" },
  { id: "JGwWNGJdvx8", title: "Ed Sheeran - Shape of You", artist: "Ed Sheeran" },
];

const PlayerContext = createContext<PlayerContextType | undefined>(undefined);

export const PlayerProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const playerRef = useRef<any>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [volume, setVolumeState] = useState(() => {
    const saved = localStorage.getItem('player-volume');
    return saved ? Number(saved) : 70;
  });
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [playerReady, setPlayerReady] = useState(false);
  const [currentIndex, setCurrentIndex] = useState(() => {
    const saved = localStorage.getItem('player-index');
    return saved ? Number(saved) : 0;
  });
  const [currentVideoTitle, setCurrentVideoTitle] = useState(() => {
    const saved = localStorage.getItem('player-index');
    const index = saved ? Number(saved) : 0;
    return playlist[index].title;
  });
  const [currentVideoArtist, setCurrentVideoArtist] = useState(() => {
    const saved = localStorage.getItem('player-index');
    const index = saved ? Number(saved) : 0;
    return playlist[index].artist;
  });
  const [isLiked, setIsLiked] = useState(false);
  const initAttempted = useRef(false);
  const savedTimeRef = useRef<number>(0);

  useEffect(() => {
    if (initAttempted.current) return;
    initAttempted.current = true;

    // Učitaj sačuvano vreme
    const savedTime = localStorage.getItem('player-time');
    if (savedTime) {
      savedTimeRef.current = Number(savedTime);
    }

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
          videoId: playlist[currentIndex].id,
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
              // Postavi sačuvano vreme
              if (savedTimeRef.current > 0) {
                event.target.seekTo(savedTimeRef.current, true);
              }
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
          const time = playerRef.current.getCurrentTime() || 0;
          setCurrentTime(time);
          setDuration(playerRef.current.getDuration() || 0);
          // Čuvaj vreme u localStorage
          localStorage.setItem('player-time', time.toString());
        } catch (e) {
          // ignore
        }
      }
    }, 1000);

    return () => clearInterval(interval);
  }, [currentIndex, volume]);

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
    const nextIndex = (currentIndex + 1) % playlist.length;
    setCurrentIndex(nextIndex);
    setCurrentVideoTitle(playlist[nextIndex].title);
    setCurrentVideoArtist(playlist[nextIndex].artist);
    localStorage.setItem('player-index', nextIndex.toString());
    localStorage.setItem('player-time', '0');
    playerRef.current.loadVideoById(playlist[nextIndex].id);
    setIsLiked(false);
  };

  const skipBackward = () => {
    if (!playerRef.current) return;
    const prevIndex = currentIndex === 0 ? playlist.length - 1 : currentIndex - 1;
    setCurrentIndex(prevIndex);
    setCurrentVideoTitle(playlist[prevIndex].title);
    setCurrentVideoArtist(playlist[prevIndex].artist);
    localStorage.setItem('player-index', prevIndex.toString());
    localStorage.setItem('player-time', '0');
    playerRef.current.loadVideoById(playlist[prevIndex].id);
    setIsLiked(false);
  };

  const setVolume = (newVolume: number) => {
    if (!playerRef.current) return;
    playerRef.current.setVolume(newVolume);
    setVolumeState(newVolume);
    localStorage.setItem('player-volume', newVolume.toString());
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

  const toggleLike = () => {
    setIsLiked(!isLiked);
  };

  return (
    <PlayerContext.Provider
      value={{
        isPlaying,
        volume,
        currentTime,
        duration,
        isFullscreen,
        currentVideoTitle,
        currentVideoArtist,
        isLiked,
        togglePlay,
        skipForward,
        skipBackward,
        setVolume,
        seekTo,
        formatTime,
        setIsFullscreen,
        toggleLike,
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
