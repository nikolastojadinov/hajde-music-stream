import { Play, Heart } from "lucide-react";
import { usePlayer } from "@/contexts/PlayerContext";
import AddToPlaylistButton from "@/components/AddToPlaylistButton";

interface TrackCardProps {
  id: string;
  title: string;
  artist: string;
  imageUrl?: string | null;
  youtubeId: string;
  duration?: number | null;
  liked?: boolean;
  onToggleLike?: (trackId: string) => Promise<void> | void;
}

const TrackCard = ({ id, title, artist, imageUrl, youtubeId, duration, liked = false, onToggleLike }: TrackCardProps) => {
  const { playTrack } = usePlayer();

  const handlePlayClick = () => {
    playTrack(youtubeId, title, artist, id);
  };

  const handleLikeClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!onToggleLike) return;
    console.log('[ui] ❤️ track click', { id });
    void onToggleLike(id);
  };

  const formatDuration = (seconds: number | null | undefined) => {
    if (!seconds) return "";
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, "0")}`;
  };

  return (
    <div
      className="group flex items-center gap-3 p-3 rounded-lg hover:bg-secondary/80 transition-all duration-300 cursor-pointer"
      onClick={handlePlayClick}
    >
      <div className="relative w-14 h-14 rounded-lg overflow-hidden bg-muted flex-shrink-0">
        {imageUrl ? (
          <img src={imageUrl} alt={title} className="w-full h-full object-cover" />
        ) : (
          <div className="w-full h-full bg-gradient-to-br from-primary/20 to-primary/5" />
        )}
        <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
          <Play className="w-6 h-6 text-foreground fill-current" />
        </div>
      </div>
      <div className="flex-1 min-w-0">
        <h3 className="font-semibold text-foreground truncate">{title}</h3>
        <p className="text-sm text-muted-foreground truncate">{artist}</p>
      </div>
      
      <div className="flex items-center gap-2 flex-shrink-0">
        <AddToPlaylistButton
          trackId={id}
          trackTitle={title}
          variant="ghost"
          triggerClassName="hover:text-primary"
          iconSize={16}
        />
        <button
          onClick={handleLikeClick}
          className="p-2 hover:scale-110 transition-transform"
          aria-label={liked ? "Unlike song" : "Like song"}
        >
          <Heart
            className={`w-5 h-5 transition-all ${
              liked
                ? "fill-primary text-primary"
                : "text-muted-foreground hover:text-foreground"
            }`}
          />
        </button>
        {duration && (
          <div className="text-sm text-muted-foreground">
            {formatDuration(duration)}
          </div>
        )}
      </div>
    </div>
  );
};

export default TrackCard;
