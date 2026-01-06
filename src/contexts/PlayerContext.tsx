import React, { createContext, useContext, useEffect, useRef, useState } from "react";

declare global {
  interface Window {
    YT: any;
    onYouTubeIframeAPIReady: () => void;
  }
}

type PlaybackContext = "song" | "playlist" | "artist";

type PlayerQueueItem = {
  youtubeVideoId: string;
  title: string;
  artist: string;
  thumbnailUrl?: string;
};

type PlayRequest = {
  track: PlayerQueueItem;
  queue?: PlayerQueueItem[];
  startIndex?: number;
  playbackContext: PlaybackContext;
  youtubePlaylistId?: string | null;
};

type PlayerContextValue = {
  isPlaying: boolean;
  volume: number;
  currentTime: number;
  duration: number;
  isFullscreen: boolean;
  isPlayerVisible: boolean;
  playbackContext: PlaybackContext | null;
  youtubeVideoId: string | null;
  youtubePlaylistId: string | null;
  currentTitle: string;
  currentArtist: string;
  currentThumbnailUrl: string | null;
  queue: PlayerQueueItem[];
  currentIndex: number;
  togglePlay: () => void;
  skipForward: () => void;
  skipBackward: () => void;
  setVolume: (value: number) => void;
  seekTo: (seconds: number) => void;
  formatTime: (seconds: number) => string;
  setIsFullscreen: (fullscreen: boolean) => void;
  setIsPlayerVisible: (visible: boolean) => void;
  play: (request: PlayRequest) => void;
  playTrack: (track: PlayerQueueItem, context?: PlaybackContext) => void;
  playCollection: (tracks: PlayerQueueItem[], startIndex?: number, context?: PlaybackContext, youtubePlaylistId?: string | null) => void;
};

const STORAGE_STATE_KEY = "ytm_player_state_v1";
const STORAGE_VOLUME_KEY = "ytm_player_volume_v1";
const FALLBACK_VIDEO_ID = "dQw4w9WgXcQ";

function normalizeString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function clampIndex(index: number, list: unknown[]): number {
  if (!Array.isArray(list) || list.length === 0) return 0;
  const max = list.length - 1;
  if (!Number.isFinite(index)) return 0;
  if (index < 0) return 0;
  if (index > max) return max;
  return index;
}

function normalizeTrack(track: PlayerQueueItem): PlayerQueueItem {
  return {
    youtubeVideoId: normalizeString(track.youtubeVideoId) || FALLBACK_VIDEO_ID,
    title: normalizeString(track.title) || "Unknown title",
    artist: normalizeString(track.artist) || "Unknown artist",
    thumbnailUrl: track.thumbnailUrl || undefined,
  };
}

function formatSeconds(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return "0:00";
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs.toString().padStart(2, "0")}`;
}

const PlayerContext = createContext<PlayerContextValue | undefined>(undefined);

export const PlayerProvider = ({ children }: { children: React.ReactNode }) => {
  const playerRef = useRef<any>(null);
  const pendingTrackRef = useRef<PlayerQueueItem | null>(null);
  const resumeAtRef = useRef<number | null>(null);
  const initAttempted = useRef(false);

  const [isPlaying, setIsPlaying] = useState(false);
  const [volume, setVolumeState] = useState(70);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [isPlayerVisible, setIsPlayerVisible] = useState(false);
  const [playbackContext, setPlaybackContext] = useState<PlaybackContext | null>(null);
  const [youtubeVideoId, setYoutubeVideoId] = useState<string | null>(null);
  const [youtubePlaylistId, setYoutubePlaylistId] = useState<string | null>(null);
  const [currentTitle, setCurrentTitle] = useState("");
  const [currentArtist, setCurrentArtist] = useState("");
  const [currentThumbnailUrl, setCurrentThumbnailUrl] = useState<string | null>(null);
  const [queue, setQueue] = useState<PlayerQueueItem[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [playerReady, setPlayerReady] = useState(false);

  const queueRef = useRef<PlayerQueueItem[]>([]);
  const indexRef = useRef(0);

  useEffect(() => {
    queueRef.current = queue;
  }, [queue]);

  useEffect(() => {
    indexRef.current = currentIndex;
  }, [currentIndex]);

  useEffect(() => {
    const savedVolume = localStorage.getItem(STORAGE_VOLUME_KEY);
    if (savedVolume) {
      const numericVolume = Math.min(100, Math.max(0, Number(savedVolume)));
      if (Number.isFinite(numericVolume)) {
        setVolumeState(numericVolume);
      }
    }

    const savedStateRaw = localStorage.getItem(STORAGE_STATE_KEY);
    if (!savedStateRaw) return;

    try {
      const saved = JSON.parse(savedStateRaw);
      const restoredTrack = {
        youtubeVideoId: normalizeString(saved.youtubeVideoId) || FALLBACK_VIDEO_ID,
        title: normalizeString(saved.title) || "Unknown title",
        artist: normalizeString(saved.artist) || "Unknown artist",
        thumbnailUrl: normalizeString(saved.thumbnailUrl) || undefined,
      };

      const restoredQueue: PlayerQueueItem[] = Array.isArray(saved.queue)
        ? saved.queue
            .map(normalizeTrack)
            .filter((t) => Boolean(t.youtubeVideoId))
        : [];

      const queueToUse = restoredQueue.length > 0 ? restoredQueue : [restoredTrack];
      const indexToUse = clampIndex(Number(saved.index ?? 0), queueToUse);
      const active = queueToUse[indexToUse] ?? restoredTrack;

      queueRef.current = queueToUse;
      setQueue(queueToUse);
      indexRef.current = indexToUse;
      setCurrentIndex(indexToUse);

      setPlaybackContext((saved.playbackContext as PlaybackContext) ?? "song");
      setYoutubePlaylistId(normalizeString(saved.youtubePlaylistId) || null);
      setCurrentTitle(active.title);
      setCurrentArtist(active.artist);
      setCurrentThumbnailUrl(active.thumbnailUrl ?? null);
      setYoutubeVideoId(active.youtubeVideoId);
      resumeAtRef.current = Number(saved.position ?? null);
      pendingTrackRef.current = active;
      setIsPlayerVisible(true);
      if (typeof saved.isFullscreen === "boolean") {
        setIsFullscreen(saved.isFullscreen);
      }
    } catch (err) {
      console.warn("Failed to restore player state", err);
    }
  }, []);

  useEffect(() => {
    if (initAttempted.current) return;
    initAttempted.current = true;

    if (!window.YT) {
      const tag = document.createElement("script");
      tag.src = "https://www.youtube.com/iframe_api";
      document.body.appendChild(tag);
    }
  }, []);

  useEffect(() => {
    const interval = setInterval(() => {
      if (!playerRef.current || typeof playerRef.current.getCurrentTime !== "function") return;

      const time = playerRef.current.getCurrentTime();
      const dur = playerRef.current.getDuration();

      if (Number.isFinite(time)) setCurrentTime(time);
      if (Number.isFinite(dur) && dur > 0) setDuration(dur);

      if (!youtubeVideoId) return;

      const stateToPersist = {
        youtubeVideoId,
        youtubePlaylistId,
        playbackContext,
        title: currentTitle,
        artist: currentArtist,
        thumbnailUrl: currentThumbnailUrl,
        position: Number.isFinite(time) ? time : 0,
        queue: queueRef.current,
        index: indexRef.current,
        isFullscreen,
      };

      localStorage.setItem(STORAGE_STATE_KEY, JSON.stringify(stateToPersist));
    }, 1000);

    return () => clearInterval(interval);
  }, [youtubeVideoId, youtubePlaylistId, playbackContext, currentTitle, currentArtist, currentThumbnailUrl, isFullscreen]);

  useEffect(() => {
    if (!isPlayerVisible && playerRef.current) {
      try {
        playerRef.current.destroy();
      } catch (err) {
        console.warn("Failed to destroy player", err);
      }
      playerRef.current = null;
      setPlayerReady(false);
      setIsPlaying(false);
    }
  }, [isPlayerVisible]);

  useEffect(() => {
    if (!isPlayerVisible) return;
    if (playerRef.current) return;

    const loadIntoPlayer = (track: PlayerQueueItem, startSeconds?: number | null) => {
      const normalized = normalizeTrack(track);
      setCurrentTitle(normalized.title);
      setCurrentArtist(normalized.artist);
      setCurrentThumbnailUrl(normalized.thumbnailUrl ?? null);
      setYoutubeVideoId(normalized.youtubeVideoId);

      if (!playerRef.current || typeof playerRef.current.loadVideoById !== "function") return;

      const payload = startSeconds && Number.isFinite(startSeconds)
        ? { videoId: normalized.youtubeVideoId, startSeconds }
        : { videoId: normalized.youtubeVideoId };

      playerRef.current.loadVideoById(payload as any);
      setIsPlaying(true);
    };

    const handleAdvance = (direction: 1 | -1) => {
      if (queueRef.current.length === 0) return;
      const nextIndex = clampIndex(indexRef.current + direction, queueRef.current);
      const nextTrack = queueRef.current[nextIndex];
      indexRef.current = nextIndex;
      setCurrentIndex(nextIndex);
      loadIntoPlayer(nextTrack, null);
    };

    const createPlayer = () => {
      const container = document.getElementById("yt-player");
      if (!container) return;

      const initialVideoId = pendingTrackRef.current?.youtubeVideoId || youtubeVideoId || FALLBACK_VIDEO_ID;

      playerRef.current = new window.YT.Player("yt-player", {
        videoId: initialVideoId,
        playerVars: {
          autoplay: 1,
          controls: 1,
          modestbranding: 1,
          rel: 0,
        },
        events: {
          onReady: (event: any) => {
            setPlayerReady(true);
            event.target.setVolume(volume);

            const active = pendingTrackRef.current || queueRef.current[indexRef.current] || null;
            if (active) {
              loadIntoPlayer(active, resumeAtRef.current);
              pendingTrackRef.current = null;
              resumeAtRef.current = null;
            }
          },
          onStateChange: (event: any) => {
            const state = event.data;
            setIsPlaying(state === 1);

            if ((state === 1 || state === 2) && playerRef.current) {
              const dur = playerRef.current.getDuration();
              if (Number.isFinite(dur) && dur > 0) setDuration(dur);
            }

            if (state === 0) handleAdvance(1);
          },
        },
      });
    };

    if (window.YT && window.YT.Player) {
      createPlayer();
    } else {
      window.onYouTubeIframeAPIReady = createPlayer;
    }
  }, [isPlayerVisible, volume, youtubeVideoId]);

  useEffect(() => {
    if (!playerRef.current) return;
    const resizeIframe = () => {
      const iframe = document.querySelector("#yt-player iframe") as HTMLIFrameElement | null;
      if (!iframe) return;
      iframe.style.width = "100%";
      iframe.style.height = "100%";
    };
    setTimeout(resizeIframe, 80);
  }, [isFullscreen]);

  const togglePlay = () => {
    if (!playerRef.current) return;
    if (isPlaying) playerRef.current.pauseVideo();
    else playerRef.current.playVideo();
  };

  const skipForward = () => {
    if (queueRef.current.length === 0) return;
    const nextIndex = (indexRef.current + 1) % queueRef.current.length;
    indexRef.current = nextIndex;
    setCurrentIndex(nextIndex);
    const nextTrack = queueRef.current[nextIndex];
    pendingTrackRef.current = nextTrack;
    if (playerReady && playerRef.current?.loadVideoById) {
      playerRef.current.loadVideoById({ videoId: nextTrack.youtubeVideoId });
      setIsPlaying(true);
    }
  };

  const skipBackward = () => {
    if (queueRef.current.length === 0) return;
    const nextIndex = indexRef.current === 0 ? queueRef.current.length - 1 : indexRef.current - 1;
    indexRef.current = nextIndex;
    setCurrentIndex(nextIndex);
    const prevTrack = queueRef.current[nextIndex];
    pendingTrackRef.current = prevTrack;
    if (playerReady && playerRef.current?.loadVideoById) {
      playerRef.current.loadVideoById({ videoId: prevTrack.youtubeVideoId });
      setIsPlaying(true);
    }
  };

  const setVolume = (value: number) => {
    const next = Math.min(100, Math.max(0, Math.round(value)));
    setVolumeState(next);
    localStorage.setItem(STORAGE_VOLUME_KEY, String(next));
    if (playerRef.current?.setVolume) {
      playerRef.current.setVolume(next);
    }
  };

  const seekTo = (seconds: number) => {
    if (!playerRef.current?.seekTo) return;
    const target = Math.max(0, seconds);
    playerRef.current.seekTo(target, true);
  };

  const play = (request: PlayRequest) => {
    const normalizedQueue = Array.isArray(request.queue)
      ? request.queue.map(normalizeTrack).filter((t) => Boolean(t.youtubeVideoId))
      : [];

    const normalizedTrack = normalizeTrack(request.track);
    const queueForPlayback = normalizedQueue.length > 0 ? normalizedQueue : [normalizedTrack];
    const startIndex = clampIndex(
      request.startIndex ?? queueForPlayback.findIndex((t) => t.youtubeVideoId === normalizedTrack.youtubeVideoId),
      queueForPlayback
    );
    const active = queueForPlayback[startIndex] ?? normalizedTrack;

    queueRef.current = queueForPlayback;
    setQueue(queueForPlayback);
    indexRef.current = startIndex;
    setCurrentIndex(startIndex);
    setPlaybackContext(request.playbackContext);
    setYoutubePlaylistId(request.youtubePlaylistId ?? null);
    setCurrentTitle(active.title);
    setCurrentArtist(active.artist);
    setCurrentThumbnailUrl(active.thumbnailUrl ?? null);
    setYoutubeVideoId(active.youtubeVideoId);
    pendingTrackRef.current = active;
    resumeAtRef.current = null;
    setIsFullscreen(false);
    setIsPlayerVisible(true);

    if (playerReady && playerRef.current?.loadVideoById) {
      playerRef.current.loadVideoById({ videoId: active.youtubeVideoId });
      setIsPlaying(true);
    }
  };

  const playTrack = (track: PlayerQueueItem, context: PlaybackContext = "song") => {
    play({ track, playbackContext: context });
  };

  const playCollection = (
    tracks: PlayerQueueItem[],
    startIndex = 0,
    context: PlaybackContext = "playlist",
    playlistId: string | null = null
  ) => {
    if (!Array.isArray(tracks) || tracks.length === 0) return;
    const normalizedQueue = tracks.map(normalizeTrack).filter((t) => Boolean(t.youtubeVideoId));
    if (normalizedQueue.length === 0) return;
    const clampedIndex = clampIndex(startIndex, normalizedQueue);
    play({
      track: normalizedQueue[clampedIndex],
      queue: normalizedQueue,
      startIndex: clampedIndex,
      playbackContext: context,
      youtubePlaylistId: playlistId,
    });
  };

  const value: PlayerContextValue = {
    isPlaying,
    volume,
    currentTime,
    duration,
    isFullscreen,
    isPlayerVisible,
    playbackContext,
    youtubeVideoId,
    youtubePlaylistId,
    currentTitle,
    currentArtist,
    currentThumbnailUrl,
    queue,
    currentIndex,
    togglePlay,
    skipForward,
    skipBackward,
    setVolume,
    seekTo,
    formatTime: formatSeconds,
    setIsFullscreen,
    setIsPlayerVisible,
    play,
    playTrack,
    playCollection,
  };

  return <PlayerContext.Provider value={value}>{children}</PlayerContext.Provider>;
};

export const usePlayer = () => {
  const ctx = useContext(PlayerContext);
  if (!ctx) throw new Error("usePlayer must be used within PlayerProvider");
  return ctx;
};

export type { PlaybackContext, PlayerQueueItem, PlayRequest };
