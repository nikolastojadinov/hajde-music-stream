import { Play, Heart, MoreHorizontal, Clock } from "lucide-react";
import { useParams } from "react-router-dom";
import { useLanguage } from "@/contexts/LanguageContext";
import { usePlaylist } from "@/hooks/usePlaylist";
import { Skeleton } from "@/components/ui/skeleton";
import { usePlayer } from "@/contexts/PlayerContext";

const Playlist = () => {
  const { t } = useLanguage();
  const { id } = useParams();
  const { data: playlist, isLoading } = usePlaylist(id);
  const { playTrack, playPlaylist } = usePlayer();

  const formatDuration = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  if (isLoading) {
    return (
      <div className="flex-1 overflow-y-auto pb-32">
        <div className="relative h-80 bg-gradient-to-b from-primary/40 to-background p-8 flex items-end">
          <div className="flex items-end gap-6">
            <Skeleton className="w-56 h-56 rounded-lg" />
            <div className="pb-4 space-y-3">
              <Skeleton className="h-4 w-20" />
              <Skeleton className="h-12 w-64" />
              <Skeleton className="h-4 w-40" />
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (!playlist) {
    return (
      <div className="flex-1 overflow-y-auto pb-32 flex items-center justify-center">
        <p className="text-muted-foreground">{t("playlist_not_found") || "Playlist not found"}</p>
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto pb-32">
      {/* Header with gradient */}
      <div className="relative h-80 bg-gradient-to-b from-primary/40 to-background p-8 flex items-end animate-fade-in">
        <div className="flex items-end gap-6">
          <div className="w-56 h-56 bg-gradient-to-br from-primary/30 to-primary/10 rounded-lg shadow-2xl flex-shrink-0 overflow-hidden">
            {playlist.image_url ? (
              <img 
                src={playlist.image_url} 
                alt={playlist.title} 
                className="w-full h-full object-cover"
              />
            ) : (
              <div className="w-full h-full bg-gradient-to-br from-primary/30 to-primary/10" />
            )}
          </div>
          <div className="pb-4">
            <p className="text-sm font-semibold mb-2 uppercase tracking-wider">{t("playlist")}</p>
            <h1 className="text-6xl font-bold mb-4">{playlist.title}</h1>
            <p className="text-muted-foreground mb-2">{playlist.description}</p>
            <div className="flex items-center gap-2 text-sm">
              <span className="font-semibold">{playlist.category}</span>
              <span className="text-muted-foreground">• {playlist.tracks.length} {t("songs")}</span>
            </div>
          </div>
        </div>
      </div>

      {/* Controls */}
      <div className="bg-background/95 backdrop-blur-sm sticky top-0 z-10 px-8 py-6 flex items-center gap-6 animate-slide-up">
        <button 
          onClick={() => playPlaylist(playlist.tracks.map(t => ({ 
            youtube_id: t.youtube_id, 
            title: t.title, 
            artist: t.artist 
          })))}
          className="w-14 h-14 bg-primary rounded-full flex items-center justify-center hover:scale-105 transition-transform shadow-lg"
        >
          <Play className="w-6 h-6 text-background fill-current ml-0.5" />
        </button>
        <button className="text-muted-foreground hover:text-primary transition-colors">
          <Heart className="w-8 h-8" />
        </button>
        <button className="text-muted-foreground hover:text-foreground transition-colors">
          <MoreHorizontal className="w-8 h-8" />
        </button>
      </div>

      {/* Song list */}
      <div className="px-8 pb-8">
        <div className="grid grid-cols-[16px_minmax(0,1fr)_3fr_minmax(120px,1fr)] gap-4 px-4 py-2 text-sm text-muted-foreground border-b border-border mb-2">
          <div>#</div>
          <div>{t("title")}</div>
          <div>{t("artist") || "Artist"}</div>
          <div className="flex justify-end">
            <Clock className="w-4 h-4" />
          </div>
        </div>

        <div className="space-y-1">
          {playlist.tracks.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              {t("no_tracks") || "No tracks in this playlist"}
            </div>
          ) : (
            playlist.tracks.map((track, index) => (
              <div
                key={track.id}
                onClick={() => {
                  const tracksArray = playlist.tracks.map(t => ({
                    youtube_id: t.youtube_id,
                    title: t.title,
                    artist: t.artist
                  }));
                  playPlaylist(tracksArray, index);
                }}
                className="grid grid-cols-[16px_minmax(0,1fr)_3fr_minmax(120px,1fr)] gap-4 px-4 py-3 rounded-md hover:bg-secondary/50 group cursor-pointer transition-colors"
              >
                <div className="flex items-center text-muted-foreground group-hover:text-foreground">
                  {index + 1}
                </div>
                <div className="flex items-center gap-3 min-w-0">
                  <div className="w-10 h-10 rounded overflow-hidden flex-shrink-0 bg-muted">
                    {track.image_url && (
                      <img 
                        src={track.image_url} 
                        alt={track.title}
                        className="w-full h-full object-cover"
                      />
                    )}
                  </div>
                  <div className="min-w-0">
                    <p className="font-medium truncate group-hover:text-primary transition-colors">
                      {track.title}
                    </p>
                    <p className="text-sm text-muted-foreground truncate">{track.artist}</p>
                  </div>
                </div>
                <div className="flex items-center text-sm text-muted-foreground truncate">
                  {track.artist}
                </div>
                <div className="flex items-center justify-end text-sm text-muted-foreground">
                  {formatDuration(track.duration)}
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
};

export default Playlist;
