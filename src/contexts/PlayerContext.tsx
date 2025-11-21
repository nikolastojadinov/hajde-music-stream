import React, { createContext, useContext, useState, useRef, useEffect } from "react";
import { usePi } from "@/contexts/PiContext";

// Player context for managing YouTube player state

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
  currentTrackId: string | null;
  isPlayerVisible: boolean;
  togglePlay: () => void;
  skipForward: () => void;
  skipBackward: () => void;
  setVolume: (volume: number) => void;
  seekTo: (seconds: number) => void;
  formatTime: (seconds: number) => string;
  setIsFullscreen: (fullscreen: boolean) => void;
  setIsPlayerVisible: (visible: boolean) => void;
  playerReady: boolean;
  playTrack: (
    youtubeId: string,
    title: string,
    artist: string,
    trackId?: string | null,
    options?: { preserveQueue?: boolean }
  ) => void;
  playPlaylist: (tracks: Array<{ id?: string | null; external_id: string; title: string; artist: string }>, startIndex?: number) => void;
};

const defaultPlaylist = [
  { external_id: "dQw4w9WgXcQ", title: "Rick Astley - Never Gonna Give You Up", artist: "Rick Astley" },
  { external_id: "9bZkp7q19f0", title: "PSY - Gangnam Style", artist: "PSY" },
  { external_id: "kJQP7kiw5Fk", title: "Luis Fonsi - Despacito", artist: "Luis Fonsi ft. Daddy Yankee" },
  { external_id: "RgKAFK5djSk", title: "Wiz Khalifa - See You Again", artist: "Wiz Khalifa ft. Charlie Puth" },
  { external_id: "JGwWNGJdvx8", title: "Ed Sheeran - Shape of You", artist: "Ed Sheeran" },
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
  const [currentTrackId, setCurrentTrackId] = useState<string | null>(null);
  const [isPlayerVisible, setIsPlayerVisible] = useState(false);
  const initAttempted = useRef(false);
  const pendingVideoRef = useRef<{ id: string; title: string; artist: string; trackId?: string | null } | null>(null);
  const [currentPlaylist, setCurrentPlaylist] = useState<Array<{ id?: string | null; external_id: string; title: string; artist: string }>>([]);
  const currentPlaylistRef = useRef<Array<{ id?: string | null; external_id: string; title: string; artist: string }>>([]);
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

  // Učitaj user ID iz PiContext és inicializálj állapotot
  const { user } = usePi();

  useEffect(() => {
    if (user?.uid) {
      setUserId(user.uid);
      cleanupOldKeys();

      const savedVolume = localStorage.getItem(getVolumeKey(user.uid));
      if (savedVolume) {
        setVolumeState(Number(savedVolume));
      }

      const savedState = localStorage.getItem(getStateKey(user.uid));
      if (savedState) {
        try {
          const { youtubeId, title, artist, time, playlist, index, isFullscreen: savedFullscreen, trackId } = JSON.parse(savedState);
          if (youtubeId && time >= 0) {
            savedSeekTimeRef.current = time;
            pendingVideoRef.current = { id: youtubeId, title: title || "", artist: artist || "", trackId: trackId ?? null };
            setCurrentVideoTitle(title || "");
            setCurrentVideoArtist(artist || "");
            setCurrentYoutubeId(youtubeId);
            setCurrentTrackId(trackId ?? null);

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
            console.log('🔄 Restored player state for user:', user.uid, { youtubeId, time, title, isFullscreen: savedFullscreen });
          }
        } catch (e) {
          console.error('Failed to restore player state:', e);
        }
      }
    } else {
      setUserId(null);
      console.log('⚠️ No Pi user - player state will not be persisted');
    }
  }, [user?.uid]);

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
              isFullscreen: isFullscreen,
              trackId: currentTrackId,
            };
            localStorage.setItem(getStateKey(userId), JSON.stringify(stateToSave));
          }
        } catch (e) {
          console.error('❌ Error updating time:', e);
        }
      }
    }, 1000);

    return () => clearInterval(interval);
  }, [currentYoutubeId, currentVideoTitle, currentVideoArtist, isFullscreen, currentTrackId, userId]);

  // Cleanup player kada se zatvori (isPlayerVisible = false)
  useEffect(() => {
    if (!isPlayerVisible && playerRef.current) {
      console.log('🧹 Player hidden - cleaning up player instance');
      
      // Destroy YouTube player instance
      if (playerRef.current.destroy) {
        try {
          playerRef.current.destroy();
        } catch (e) {
          console.error('Error destroying player:', e);
        }
      }
      
      playerRef.current = null;
      setPlayerReady(false);
      console.log('✅ Player cleanup complete');
    }
  }, [isPlayerVisible]);

  // Kreiraj player samo kada postane vidljiv
  useEffect(() => {
    // Ne kreiraj player ako nije vidljiv
    if (!isPlayerVisible) return;
    
    // Ako player već postoji, ne kreiraj ponovo
    if (playerRef.current) return;

    const createPlayer = () => {
      const container = document.getElementById("yt-player");
      if (!container) {
        console.log('⚠️ yt-player container not found');
        return;
      }
      
      if (playerRef.current) {
        console.log('⚠️ Player already exists');
        return;
      }

      // Uzmi video ID iz pending ili default
      const videoId = pendingVideoRef.current?.id || defaultPlaylist[0].external_id;

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
                setCurrentTrackId(videoToLoad.trackId ?? null);
                
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
                  setCurrentYoutubeId(nextTrack.external_id);
                  setCurrentTrackId(nextTrack.id ?? null);
                  playerRef.current.loadVideoById(nextTrack.external_id);
                  setTimeout(() => {
                    if (playerRef.current && playerRef.current.playVideo) {
                      playerRef.current.playVideo();
                    }
                  }, 100);
                }
              }
            },
          },
        });
      } catch (error) {
        // Player creation failed
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

  // Force resize YouTube iframe when switching between mini and fullscreen
  useEffect(() => {
    if (!playerRef.current) return;

    const resizeIframe = () => {
      const iframe = document.querySelector('#yt-player iframe') as HTMLIFrameElement;
      if (!iframe) return;

      if (isFullscreen) {
        // Fullscreen mode - iframe should fill the aspect ratio container
        console.log('🎬 Resizing iframe to fullscreen mode');
        // The CSS will handle sizing, but we trigger reflow
        iframe.style.width = '100%';
        iframe.style.height = '100%';
      } else {
        // Mini mode - iframe should be 200x200
        console.log('🎬 Resizing iframe to mini mode');
        iframe.style.width = '200px';
        iframe.style.height = '200px';
      }
    };

    // Delay to allow DOM to update
    setTimeout(resizeIframe, 100);
  }, [isFullscreen]);

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
    setCurrentYoutubeId(nextTrack.external_id);
    setCurrentTrackId(nextTrack.id ?? null);
    playerRef.current.loadVideoById(nextTrack.external_id);
    setTimeout(() => {
      if (playerRef.current && playerRef.current.playVideo) {
        playerRef.current.playVideo();
      }
    }, 100);
  };

  const skipBackward = () => {
    if (!playerRef.current || currentPlaylistRef.current.length === 0) return;
    const prevIndex = currentIndexRef.current === 0 ? currentPlaylistRef.current.length - 1 : currentIndexRef.current - 1;
    const prevTrack = currentPlaylistRef.current[prevIndex];
    
    currentIndexRef.current = prevIndex;
    setCurrentIndex(prevIndex);
    setCurrentVideoTitle(prevTrack.title);
    setCurrentVideoArtist(prevTrack.artist);
    setCurrentYoutubeId(prevTrack.external_id);
    setCurrentTrackId(prevTrack.id ?? null);
    playerRef.current.loadVideoById(prevTrack.external_id);
    setTimeout(() => {
      if (playerRef.current && playerRef.current.playVideo) {
        playerRef.current.playVideo();
      }
    }, 100);
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

  const playTrack = (
    youtubeId: string,
    title: string,
    artist: string,
    trackId?: string | null,
    options?: { preserveQueue?: boolean }
  ) => {
    console.log('🎵 playTrack called:', { 
      youtubeId, 
      title, 
      artist, 
      playerReady, 
      playerExists: !!playerRef.current,
      isPlayerVisible 
    });
    
    setCurrentVideoTitle(title);
    setCurrentVideoArtist(artist);
    setCurrentYoutubeId(youtubeId);
    setCurrentTrackId(trackId ?? null);
    
    if (!options?.preserveQueue) {
      // Reset playlist to single track when not preserving an existing queue
      const singleTrackPlaylist = [{ id: trackId ?? null, external_id: youtubeId, title, artist }];
      currentPlaylistRef.current = singleTrackPlaylist;
      setCurrentPlaylist(singleTrackPlaylist);
      currentIndexRef.current = 0;
      setCurrentIndex(0);
    }
    
    // Prvo postavi player kao visible
    setIsPlayerVisible(true);
    
    if (playerRef.current && playerReady && playerRef.current.loadVideoById) {
      console.log('✅ Player ready - loading video:', youtubeId);
      playerRef.current.loadVideoById(youtubeId);
      setTimeout(() => {
        if (playerRef.current && playerRef.current.playVideo) {
          console.log('▶️ Starting playback');
          playerRef.current.playVideo();
        }
      }, 100);
      setIsPlaying(true);
    } else {
      console.log('⏳ Player not ready - queuing video', {
        hasPlayer: !!playerRef.current,
        playerReady,
        hasLoadMethod: !!(playerRef.current?.loadVideoById)
      });
      pendingVideoRef.current = { id: youtubeId, title, artist, trackId: trackId ?? null };
      
      // Ako player ne postoji ali je bio vidljiv, resetuj playerReady
      if (!playerRef.current && isPlayerVisible) {
        console.log('🔄 Resetting playerReady flag');
        setPlayerReady(false);
      }
    }
  };

  const playPlaylist = (tracks: Array<{ id?: string | null; external_id: string; title: string; artist: string }>, startIndex = 0) => {
    if (tracks.length === 0) return;
    
    currentPlaylistRef.current = tracks;
    currentIndexRef.current = startIndex;
    
    setCurrentPlaylist(tracks);
    setCurrentIndex(startIndex);
    
    const track = tracks[startIndex];
    playTrack(track.external_id, track.title, track.artist, track.id ?? null, { preserveQueue: true });
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
        currentTrackId,
        isPlayerVisible,
        togglePlay,
        skipForward,
        skipBackward,
        setVolume,
        seekTo,
        formatTime,
        setIsFullscreen,
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
