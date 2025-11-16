import React, { createContext, useContext, useState, useRef, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";

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
  const [userId, setUserId] = useState<string | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [volume, setVolumeState] = useState(70);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [playerReady, setPlayerReady] = useState(false);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [currentVideoTitle, setCurrentVideoTitle] = useState("");
  const [currentVideoArtist, setCurrentVideoArtist] = useState("");
  const [currentYoutubeId, setCurrentYoutubeId] = useState("");
  const [isLiked, setIsLiked] = useState(false);
  const [isPlayerVisible, setIsPlayerVisible] = useState(false);
  const initAttempted = useRef(false);
  const pendingVideoRef = useRef<{ id: string; title: string; artist: string } | null>(null);
  const [currentPlaylist, setCurrentPlaylist] = useState<Array<{ youtube_id: string; title: string; artist: string }>>([]);
  const currentPlaylistRef = useRef<Array<{ youtube_id: string; title: string; artist: string }>>([]);
  const currentIndexRef = useRef(0);
  const savedSeekTimeRef = useRef<number | null>(null);

  // Helper funkcije za localStorage ključeve
  const getStateKey = (uid: string) => `pmstate_${uid}_state`;
  const getVolumeKey = (uid: string) => `pmstate_${uid}_volume`;
  
  // Očisti stare globalne ključeve
  const cleanupOldKeys = () => {
    localStorage.removeItem('player-state');
    localStorage.removeItem('player-volume');
    localStorage.removeItem('lastTrackId');
    localStorage.removeItem('lastPlayerTime');
    localStorage.removeItem('lastPlayerMode');
  };
  
  // Sinhronizuj refs sa state
  useEffect(() => {
    currentPlaylistRef.current = currentPlaylist;
  }, [currentPlaylist]);
  
  useEffect(() => {
    currentIndexRef.current = currentIndex;
  }, [currentIndex]);

  // Učitaj user ID i inicijalizuj player state
  useEffect(() => {
    const initAuth = async () => {
      const { data: { user } } = await supabase.auth.getUser();
      
      if (user?.id) {
        setUserId(user.id);
        cleanupOldKeys();
        
        // Učitaj volume za ovog korisnika
        const savedVolume = localStorage.getItem(getVolumeKey(user.id));
        if (savedVolume) {
          setVolumeState(Number(savedVolume));
        }
        
        // Učitaj player state za ovog korisnika
        const savedState = localStorage.getItem(getStateKey(user.id));
        if (savedState) {
          try {
            const { youtubeId, title, artist, time, playlist, index, isFullscreen: savedFullscreen } = JSON.parse(savedState);
            if (youtubeId && time >= 0) {
              savedSeekTimeRef.current = time;
              pendingVideoRef.current = { id: youtubeId, title: title || "", artist: artist || "" };
              setCurrentVideoTitle(title || "");
              setCurrentVideoArtist(artist || "");
              setCurrentYoutubeId(youtubeId);
              
              if (playlist && Array.isArray(playlist)) {
                currentPlaylistRef.current = playlist;
                setCurrentPlaylist(playlist);
                setCurrentIndex(index || 0);
                currentIndexRef.current = index || 0;
              }
              
              if (savedFullscreen !== undefined) {
                setIsFullscreen(savedFullscreen);
              }
              
              setIsPlayerVisible(true);
              console.log('🔄 Restored player state for user:', user.id, { youtubeId, time, title, isFullscreen: savedFullscreen });
            }
          } catch (e) {
            console.error('Failed to restore player state:', e);
          }
        }
      } else {
        console.log('⚠️ No user logged in - player state will not be persisted');
      }
    };

    initAuth();

    // Slušaj promene auth stanja
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === 'SIGNED_IN' && session?.user?.id) {
        setUserId(session.user.id);
        cleanupOldKeys();
      } else if (event === 'SIGNED_OUT') {
        setUserId(null);
        // Resetuj player state kada se user izloguje
        setIsPlayerVisible(false);
        setCurrentYoutubeId("");
        setCurrentVideoTitle("");
        setCurrentVideoArtist("");
        setCurrentTime(0);
        setDuration(0);
      }
    });

    return () => subscription.unsubscribe();
  }, []);

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
  }, []);

  // Poseban useEffect za ažuriranje vremena i čuvanje stanja
  useEffect(() => {
    const interval = setInterval(() => {
      if (playerRef.current && playerRef.current.getCurrentTime) {
        try {
          const time = playerRef.current.getCurrentTime();
          const dur = playerRef.current.getDuration();
          
          console.log('⏱️ Time update:', { time, duration: dur, youtubeId: currentYoutubeId, userId });
          
          if (time !== undefined && time !== null) {
            setCurrentTime(time);
          }
          
          if (dur !== undefined && dur !== null && dur > 0) {
            setDuration(dur);
          }
          
          // Čuvaj stanje SAMO ako je korisnik ulogovan
          if (userId && currentYoutubeId && time > 0) {
            const stateToSave = {
              youtubeId: currentYoutubeId,
              title: currentVideoTitle,
              artist: currentVideoArtist,
              time: time,
              playlist: currentPlaylistRef.current,
              index: currentIndexRef.current,
              isFullscreen: isFullscreen
            };
            localStorage.setItem(getStateKey(userId), JSON.stringify(stateToSave));
          }
        } catch (e) {
          console.error('❌ Error updating time:', e);
        }
      }
    }, 1000);

    return () => clearInterval(interval);
  }, [currentYoutubeId, currentVideoTitle, currentVideoArtist, isFullscreen, userId]);

  // Kreiraj player samo kada postane vidljiv
  useEffect(() => {
    console.log('🎬 [PlayerContext] isPlayerVisible changed:', isPlayerVisible);
    console.log('🎬 [PlayerContext] playerRef.current exists:', !!playerRef.current);
    
    if (!isPlayerVisible || playerRef.current) return;

    const createPlayer = () => {
      console.log('🎬 [PlayerContext] createPlayer called');
      const container = document.getElementById("yt-player");
      console.log('🎬 [PlayerContext] Container found:', !!container);
      console.log('🎬 [PlayerContext] Window.YT available:', !!window.YT);
      console.log('🎬 [PlayerContext] Window.YT.Player available:', !!window.YT?.Player);
      
      if (!container || playerRef.current) return;

      // Uzmi video ID iz pending ili default
      const videoId = pendingVideoRef.current?.id || playlist[0].id;
      console.log('🎬 [PlayerContext] Creating player with video ID:', videoId);

      try {
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
              console.log('🎬 YouTube player ready');
              event.target.setVolume(volume);
              setPlayerReady(true);
              
              if (pendingVideoRef.current) {
                const videoToLoad = pendingVideoRef.current;
                setCurrentVideoTitle(videoToLoad.title);
                setCurrentVideoArtist(videoToLoad.artist);
                setCurrentYoutubeId(videoToLoad.id);
                
                console.log('📼 Loading video:', videoToLoad.id);
                
                // Ako postoji sačuvano vreme, koristi startSeconds opciju
                if (savedSeekTimeRef.current !== null) {
                  const seekTime = savedSeekTimeRef.current;
                  console.log('⏩ Loading video at position:', seekTime);
                  
                  // loadVideoById sa startSeconds automatski pokreće video od te pozicije
                  event.target.loadVideoById({
                    videoId: videoToLoad.id,
                    startSeconds: seekTime
                  });
                  
                  savedSeekTimeRef.current = null;
                } else {
                  // Normalno učitavanje bez seek-a
                  event.target.loadVideoById(videoToLoad.id);
                }
                
                pendingVideoRef.current = null;
              }
            },
            onStateChange: (event: any) => {
              const state = event.data;
              console.log('📺 Player state changed:', state, '(1=playing, 2=paused, 0=ended)');
              
              setIsPlaying(state === 1);
              
              // Kada se video učita (state 1 ili 2), proveri duration
              if ((state === 1 || state === 2) && playerRef.current) {
                const dur = playerRef.current.getDuration();
                console.log('🎬 Video loaded, duration:', dur);
                if (dur > 0) {
                  setDuration(dur);
                }
              }
              
              // Završen video - pređi na sledeći
              if (state === 0) {
                const playlist = currentPlaylistRef.current;
                const index = currentIndexRef.current;
                
                if (playlist.length > 0 && playerRef.current) {
                  const nextIndex = (index + 1) % playlist.length;
                  const nextTrack = playlist[nextIndex];
                  
                  setCurrentIndex(nextIndex);
                  setCurrentVideoTitle(nextTrack.title);
                  setCurrentVideoArtist(nextTrack.artist);
                  setCurrentYoutubeId(nextTrack.youtube_id);
                  playerRef.current.loadVideoById(nextTrack.youtube_id);
                  setIsLiked(false);
                }
              }
            },
          },
        });
      } catch (error) {
        console.error('❌ [PlayerContext] Player creation failed:', error);
      }
    };

    // Čekaj da se API učita
    console.log('🎬 [PlayerContext] Checking YouTube API availability...');
    if (window.YT && window.YT.Player) {
      console.log('✅ [PlayerContext] YouTube API already loaded, creating player in 300ms');
      setTimeout(createPlayer, 300);
    } else {
      console.log('⏳ [PlayerContext] YouTube API not loaded yet, waiting for onYouTubeIframeAPIReady');
      window.onYouTubeIframeAPIReady = () => {
        console.log('✅ [PlayerContext] YouTube API loaded via callback');
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
    
    currentIndexRef.current = nextIndex;
    setCurrentIndex(nextIndex);
    setCurrentVideoTitle(nextTrack.title);
    setCurrentVideoArtist(nextTrack.artist);
    setCurrentYoutubeId(nextTrack.youtube_id);
    playerRef.current.loadVideoById(nextTrack.youtube_id);
    setIsLiked(false);
  };

  const skipBackward = () => {
    if (!playerRef.current || currentPlaylistRef.current.length === 0) return;
    const prevIndex = currentIndexRef.current === 0 ? currentPlaylistRef.current.length - 1 : currentIndexRef.current - 1;
    const prevTrack = currentPlaylistRef.current[prevIndex];
    
    currentIndexRef.current = prevIndex;
    setCurrentIndex(prevIndex);
    setCurrentVideoTitle(prevTrack.title);
    setCurrentVideoArtist(prevTrack.artist);
    setCurrentYoutubeId(prevTrack.youtube_id);
    playerRef.current.loadVideoById(prevTrack.youtube_id);
    setIsLiked(false);
  };

  const setVolume = (newVolume: number) => {
    if (!playerRef.current) return;
    playerRef.current.setVolume(newVolume);
    setVolumeState(newVolume);
    
    // Čuvaj volume SAMO ako je korisnik ulogovan
    if (userId) {
      localStorage.setItem(getVolumeKey(userId), newVolume.toString());
    }
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
    console.log('🎵 [PlayerContext] playTrack called:', { youtubeId, title, artist });
    console.log('🎵 [PlayerContext] Player state:', { 
      playerReady, 
      hasPlayerRef: !!playerRef.current,
      hasLoadMethod: !!playerRef.current?.loadVideoById,
      isPlayerVisible
    });
    
    setCurrentVideoTitle(title);
    setCurrentVideoArtist(artist);
    setCurrentYoutubeId(youtubeId);
    
    if (playerRef.current && playerReady && playerRef.current.loadVideoById) {
      console.log('✅ [PlayerContext] Loading video directly');
      playerRef.current.loadVideoById(youtubeId);
      setIsPlaying(true);
    } else {
      console.log('⏳ [PlayerContext] Player not ready, setting pendingVideoRef');
      pendingVideoRef.current = { id: youtubeId, title, artist };
    }
    
    setIsPlayerVisible(true);
    console.log('👀 [PlayerContext] Player visibility set to true');
  };

  const playPlaylist = (tracks: Array<{ youtube_id: string; title: string; artist: string }>, startIndex = 0) => {
    console.log('🎵 [PlayerContext] playPlaylist called:', { 
      trackCount: tracks.length, 
      startIndex,
      firstTrack: tracks[0]
    });
    
    if (tracks.length === 0) {
      console.warn('⚠️ [PlayerContext] Empty playlist provided');
      return;
    }
    
    currentPlaylistRef.current = tracks;
    currentIndexRef.current = startIndex;
    
    setCurrentPlaylist(tracks);
    setCurrentIndex(startIndex);
    
    const track = tracks[startIndex];
    console.log('🎵 [PlayerContext] Starting track:', track);
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
