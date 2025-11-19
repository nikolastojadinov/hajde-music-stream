import { Play, Heart } from "lucide-react";
import { usePlayer } from "@/contexts/PlayerContext";
import useLikes from "@/hooks/useLikes";

interface TrackCardProps {
  id: string;
  title: string;
  artist: string;
  imageUrl?: string | null;
  youtubeId: string;
  duration?: number | null;
}

const TrackCard = ({ id, title, artist, imageUrl, youtubeId, duration }: TrackCardProps) => {
  const { playTrack } = usePlayer();
  const { isTrackLiked, toggleTrackLike } = useLikes();
  const isLiked = isTrackLiked(id);

  const handlePlayClick = () => {
    playTrack(youtubeId, title, artist);
  };

  const handleLikeClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    toggleTrackLike(id);
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
      
      {/* Like button */}
      <button
        onClick={handleLikeClick}
        className="p-2 hover:scale-110 transition-transform flex-shrink-0"
        aria-label={isLiked ? "Unlike song" : "Like song"}
      >
        <Heart 
          className={`w-5 h-5 transition-all ${
            isLiked 
              ? "fill-primary text-primary" 
              : "text-muted-foreground hover:text-foreground"
          }`}
        />
      </button>
      
      {duration && (
        <div className="text-sm text-muted-foreground flex-shrink-0">
          {formatDuration(duration)}
        </div>
      )}
    </div>
  );
};

export default TrackCard;
