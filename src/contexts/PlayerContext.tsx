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
  isPlayerVisible: boolean;
  togglePlay: () => void;
  skipForward: () => void;
  skipBackward: () => void;
  setVolume: (volume: number) => void;
  seekTo: (seconds: number) => void;
  formatTime: (seconds: number) => string;
  setIsFullscreen: (fullscreen: boolean) => void;
  toggleLike: () => void;
  setIsPlayerVisible: (visible: boolean) => void;
  playerReady: boolean;
  playTrack: (youtubeId: string, title: string, artist: string) => void;
  playPlaylist: (tracks: Array<{ youtube_id: string; title: string; artist: string }>, startIndex?: number) => void;
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
  const [currentIndex, setCurrentIndex] = useState(0);
  const [currentVideoTitle, setCurrentVideoTitle] = useState("");
  const [currentVideoArtist, setCurrentVideoArtist] = useState("");
  const [isLiked, setIsLiked] = useState(false);
  const [isPlayerVisible, setIsPlayerVisible] = useState(false);
  const initAttempted = useRef(false);
  const pendingVideoRef = useRef<{ id: string; title: string; artist: string } | null>(null);
  const [currentPlaylist, setCurrentPlaylist] = useState<Array<{ youtube_id: string; title: string; artist: string }>>([]);
  const currentPlaylistRef = useRef<Array<{ youtube_id: string; title: string; artist: string }>>([]);
  const currentIndexRef = useRef(0);
  
  // Sinhronizuj refs sa state
  useEffect(() => {
    currentPlaylistRef.current = currentPlaylist;
  }, [currentPlaylist]);
  
  useEffect(() => {
    currentIndexRef.current = currentIndex;
  }, [currentIndex]);

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

    // Ažuriraj vreme
    const interval = setInterval(() => {
      if (playerRef.current && playerRef.current.getCurrentTime) {
        try {
          const time = playerRef.current.getCurrentTime() || 0;
          setCurrentTime(time);
          setDuration(playerRef.current.getDuration() || 0);
        } catch (e) {
          // ignore
        }
      }
    }, 1000);

    return () => clearInterval(interval);
  }, []);

  // Kreiraj player samo kada postane vidljiv
  useEffect(() => {
    if (!isPlayerVisible || playerRef.current) return;

    const createPlayer = () => {
      const container = document.getElementById("yt-player");
      if (!container || playerRef.current) return;

      // Uzmi video ID iz pending ili default
      const videoId = pendingVideoRef.current?.id || playlist[0].id;

      try {
        console.log("Creating player with video:", videoId);
        playerRef.current = new window.YT.Player("yt-player", {
          videoId: videoId,
          playerVars: {
            autoplay: 1,
            controls: 1,
            modestbranding: 1,
            rel: 0,
          },
          events: {
            onReady: (event: any) => {
              console.log("Player ready");
              event.target.setVolume(volume);
              setPlayerReady(true);
              
              // Ako imamo pending video, pusti ga
              if (pendingVideoRef.current) {
                console.log("Loading pending video:", pendingVideoRef.current.id);
                setCurrentVideoTitle(pendingVideoRef.current.title);
                setCurrentVideoArtist(pendingVideoRef.current.artist);
                event.target.loadVideoById(pendingVideoRef.current.id);
                pendingVideoRef.current = null;
              }
            },
            onStateChange: (event: any) => {
              setIsPlaying(event.data === 1);
              
              // Auto-play sledeće pesme kada se trenutna završi
              if (event.data === 0) { // 0 = ended
                const playlist = currentPlaylistRef.current;
                const index = currentIndexRef.current;
                
                if (playlist.length > 0 && playerRef.current) {
                  const nextIndex = (index + 1) % playlist.length;
                  const nextTrack = playlist[nextIndex];
                  
                  console.log("Video ended, playing next:", nextTrack);
                  setCurrentIndex(nextIndex);
                  setCurrentVideoTitle(nextTrack.title);
                  setCurrentVideoArtist(nextTrack.artist);
                  playerRef.current.loadVideoById(nextTrack.youtube_id);
                  setIsLiked(false);
                }
              }
            },
            onError: (event: any) => {
              console.error("YouTube player error:", event.data);
            },
          },
        });
      } catch (error) {
        console.error("Error creating player:", error);
      }
    };

    // Čekaj da se API učita
    if (window.YT && window.YT.Player) {
      setTimeout(createPlayer, 300);
    } else {
      window.onYouTubeIframeAPIReady = () => {
        setTimeout(createPlayer, 300);
      };
    }
  }, [isPlayerVisible, volume]);

  const togglePlay = () => {
    if (!playerRef.current) return;
    
    if (isPlaying) {
      playerRef.current.pauseVideo();
    } else {
      playerRef.current.playVideo();
    }
  };

  const skipForward = () => {
    if (!playerRef.current || currentPlaylistRef.current.length === 0) return;
    const nextIndex = (currentIndexRef.current + 1) % currentPlaylistRef.current.length;
    const nextTrack = currentPlaylistRef.current[nextIndex];
    
    console.log("Skip forward to:", nextTrack, "from index:", currentIndexRef.current, "to:", nextIndex);
    currentIndexRef.current = nextIndex; // Ažuriraj ref ODMAH
    setCurrentIndex(nextIndex);
    setCurrentVideoTitle(nextTrack.title);
    setCurrentVideoArtist(nextTrack.artist);
    playerRef.current.loadVideoById(nextTrack.youtube_id);
    setIsLiked(false);
  };

  const skipBackward = () => {
    if (!playerRef.current || currentPlaylistRef.current.length === 0) return;
    const prevIndex = currentIndexRef.current === 0 ? currentPlaylistRef.current.length - 1 : currentIndexRef.current - 1;
    const prevTrack = currentPlaylistRef.current[prevIndex];
    
    console.log("Skip backward to:", prevTrack, "from index:", currentIndexRef.current, "to:", prevIndex);
    currentIndexRef.current = prevIndex; // Ažuriraj ref ODMAH
    setCurrentIndex(prevIndex);
    setCurrentVideoTitle(prevTrack.title);
    setCurrentVideoArtist(prevTrack.artist);
    playerRef.current.loadVideoById(prevTrack.youtube_id);
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

  const playTrack = (youtubeId: string, title: string, artist: string) => {
    console.log("playTrack called:", { youtubeId, title, artist });
    setCurrentVideoTitle(title);
    setCurrentVideoArtist(artist);
    
    // Ako nema playliste, napravi playlistu od jedne pesme
    if (currentPlaylist.length === 0) {
      setCurrentPlaylist([{ youtube_id: youtubeId, title, artist }]);
      setCurrentIndex(0);
    }
    
    // Ako player već postoji i spreman je
    if (playerRef.current && playerReady && playerRef.current.loadVideoById) {
      console.log("Player exists, loading video");
      playerRef.current.loadVideoById(youtubeId);
      setIsPlaying(true);
    } else {
      // Sačuvaj video za kasnije učitavanje
      console.log("Player not ready, saving pending video");
      pendingVideoRef.current = { id: youtubeId, title, artist };
    }
    
    setIsPlayerVisible(true);
  };

  const playPlaylist = (tracks: Array<{ youtube_id: string; title: string; artist: string }>, startIndex = 0) => {
    if (tracks.length === 0) return;
    
    console.log("Playing playlist with", tracks.length, "tracks, starting at", startIndex);
    setCurrentPlaylist(tracks);
    setCurrentIndex(startIndex);
    
    const track = tracks[startIndex];
    playTrack(track.youtube_id, track.title, track.artist);
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
        isPlayerVisible,
        togglePlay,
        skipForward,
        skipBackward,
        setVolume,
        seekTo,
        formatTime,
        setIsFullscreen,
        toggleLike,
        setIsPlayerVisible,
        playerReady,
        playTrack,
        playPlaylist,
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
