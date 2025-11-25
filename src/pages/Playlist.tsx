import { useEffect, useMemo, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import { Play, Pause, Heart } from "lucide-react";
import { Button } from "@/components/ui/button";
import { usePlayer } from "@/contexts/PlayerContext";
import { Skeleton } from "@/components/ui/skeleton";
import { useExternalPlaylist } from "@/hooks/useExternalPlaylist";
import useLikes from "@/hooks/useLikes";
import { useLanguage } from "@/contexts/LanguageContext";
import { PlaylistHeaderStats } from "@/components/playlists/PlaylistHeaderStats";
import { useSWRConfig } from "swr";
import { withBackendOrigin } from "@/lib/backendUrl";

const Playlist = () => {
  const { id } = useParams<{ id: string }>();
  const { playPlaylist, isPlaying, togglePlay } = usePlayer();
  const { isPlaylistLiked, togglePlaylistLike } = useLikes();
  const { t } = useLanguage();
  const [currentTrackId, setCurrentTrackId] = useState<string | null>(null);
  const { mutate } = useSWRConfig();
  const lastLoggedViewId = useRef<string | null>(null);

  console.log('🎵 Playlist page mounted, ID:', id);
  
  const { data: playlist, isLoading, error } = useExternalPlaylist(id || "");
  const isLiked = id ? isPlaylistLiked(id) : false;
  const statsKey = useMemo(() => (id ? withBackendOrigin(`/api/playlists/${id}/public-stats`) : null), [id]);
  const viewUrl = useMemo(() => (id ? withBackendOrigin(`/api/playlists/${id}/public-view`) : null), [id]);

  useEffect(() => {
    if (!id || lastLoggedViewId.current === id || !viewUrl || !statsKey) {
      return;
    }

    lastLoggedViewId.current = id;

    const controller = new AbortController();
    fetch(viewUrl, {
      method: 'POST',
      credentials: 'include',
      signal: controller.signal,
    })
      .then(() => mutate(statsKey))
      .catch((err: any) => {
      if (err?.name === 'AbortError') return;
      console.warn('[playlist] Failed to register public view', err);
      });

    return () => {
      controller.abort();
    };
  }, [id, mutate, statsKey, viewUrl]);
  
  console.log('📊 Playlist state:', { isLoading, hasError: !!error, hasPlaylist: !!playlist, trackCount: playlist?.tracks?.length });

  const formatDuration = (seconds: number | null) => {
    if (!seconds) return "0:00";
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, "0")}`;
  };

  const handlePlayPlaylist = () => {
    if (playlist && playlist.tracks.length > 0) {
      const trackData = playlist.tracks.map(t => ({
        id: t.id,
        external_id: t.external_id,
        title: t.title,
        artist: t.artist
      }));
      playPlaylist(trackData, 0);
      setCurrentTrackId(playlist.tracks[0].id);
    }
  };

  const handlePlayTrack = (track: any, index: number) => {
    if (playlist) {
      const trackData = playlist.tracks.map(t => ({
        id: t.id,
        external_id: t.external_id,
        title: t.title,
        artist: t.artist
      }));
      playPlaylist(trackData, index);
      setCurrentTrackId(track.id);
    }
  };

  const handleToggleLike = async () => {
    if (!id) return;
    console.log('[ui] ❤️ playlist header click', { id });
    try {
      await togglePlaylistLike(id);
    } finally {
      if (statsKey) {
        mutate(statsKey);
      }
    }
  };

  if (isLoading) {
    return (
      <div className="flex-1 overflow-y-auto pb-32">
        <div className="relative h-80 bg-gradient-to-b from-purple-900/40 to-background p-8">
          <Skeleton className="w-56 h-56 rounded-lg" />
        </div>
      </div>
    );
  }

  if (error) {
    console.error('❌ Playlist error:', error);
    return (
      <div className="flex-1 overflow-y-auto pb-32 flex items-center justify-center">
        <div className="text-center p-4">
          <h2 className="text-2xl font-bold mb-2">{t("playlist_load_error")}</h2>
          <p className="text-muted-foreground mb-4">
            {error instanceof Error ? error.message : t("unknown_error")}
          </p>
          <Button onClick={() => window.location.reload()}>
            {t("try_again")}
          </Button>
        </div>
      </div>
    );
  }

  if (!playlist) {
    console.warn('⚠️ Playlist not found');
    return (
      <div className="flex-1 overflow-y-auto pb-32 flex items-center justify-center">
        <div className="text-center p-4">
          <h2 className="text-2xl font-bold mb-2">{t("playlist_not_found")}</h2>
          <p className="text-muted-foreground mb-4">ID: {id}</p>
          <Button onClick={() => window.history.back()}>
            {t("back")}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto pb-32">
      <div className="relative bg-gradient-to-b from-purple-900/40 to-background p-4 md:p-8">
        <div className="flex flex-col md:flex-row md:items-end gap-4">
          <div className="w-40 h-40 md:w-48 md:h-48 rounded-lg overflow-hidden">
            <img src={playlist.cover_url || "/placeholder.svg"} alt={playlist.title} className="w-full h-full object-cover" />
          </div>
          <div>
            <h1 className="text-3xl md:text-5xl font-black">{playlist.title}</h1>
            <p className="text-sm text-muted-foreground mt-2">
              {playlist.tracks.length} {t("songs")}
            </p>
          </div>
        </div>
      </div>

      <div className="p-4 md:p-8">
        <div className="flex flex-wrap items-center gap-4 mb-6">
          <Button size="lg" className="rounded-full" onClick={handlePlayPlaylist}>
            <Play className="w-5 h-5 mr-2 fill-current" />
            {t("play_all")}
          </Button>
          
          {/* Like button */}
          <button
            onClick={handleToggleLike}
            className="w-12 h-12 rounded-full bg-secondary hover:bg-secondary/80 flex items-center justify-center hover:scale-110 transition-all"
            aria-label={isLiked ? t("unlike_playlist") : t("like_playlist")}
          >
            <Heart 
              className={`w-6 h-6 transition-all ${
                isLiked 
                  ? "fill-primary text-primary" 
                  : "text-muted-foreground"
              }`}
            />
          </button>

          {id && <PlaylistHeaderStats playlistId={id} />}
        </div>

        <div className="space-y-2">
          {playlist.tracks.map((track, index) => {
            const isCurrent = currentTrackId === track.id;
            return (
              <div
                key={track.id}
                className={`group flex items-center gap-3 p-2 rounded-lg hover:bg-white/5 cursor-pointer ${isCurrent ? "bg-white/10" : ""}`}
                onClick={() => handlePlayTrack(track, index)}
              >
                <div className="w-12 h-12 rounded overflow-hidden flex-shrink-0 bg-card relative">
                  {track.cover_url ? (
                    <img 
                      src={track.cover_url} 
                      alt={track.title}
                      className="w-full h-full object-cover"
                      onError={(e) => {
                        (e.target as HTMLImageElement).src = playlist.cover_url || "/placeholder.svg";
                      }}
                    />
                  ) : (
                    <img 
                      src={playlist.cover_url || "/placeholder.svg"} 
                      alt={track.title}
                      className="w-full h-full object-cover opacity-50"
                    />
                  )}
                  {isCurrent && (
                    <div className="absolute inset-0 bg-black/40 flex items-center justify-center">
                      <button onClick={(e) => { e.stopPropagation(); togglePlay(); }} className="text-primary">
                        {isPlaying ? <Pause className="w-5 h-5" /> : <Play className="w-5 h-5" />}
                      </button>
                    </div>
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <div className={`font-medium truncate ${isCurrent ? "text-primary" : ""}`}>{track.title}</div>
                  <div className="text-sm text-muted-foreground truncate">{track.artist}</div>
                </div>
                <div className="text-sm text-muted-foreground hidden sm:block">{formatDuration(track.duration)}</div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};

export default Playlist;
