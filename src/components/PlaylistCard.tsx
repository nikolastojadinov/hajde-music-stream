import { Link } from "react-router-dom";
import { Heart } from "lucide-react";
import useLikes from "@/hooks/useLikes";

interface PlaylistCardProps {
  id: string;
  title: string;
  description: string;
  imageUrl?: string;
}

const PlaylistCard = ({ id, title, description, imageUrl }: PlaylistCardProps) => {
  const { isPlaylistLiked, togglePlaylistLike } = useLikes();
  const isLiked = isPlaylistLiked(id);

  const handleLikeClick = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    togglePlaylistLike(id);
  };

  return (
    <Link
      to={`/playlist/${id}`}
      className="group block relative"
    >
      <div className="bg-card p-4 rounded-xl hover:bg-secondary/80 transition-all duration-300 overflow-hidden">
        <div className="relative mb-4 aspect-square rounded-lg overflow-hidden bg-muted">
          {imageUrl ? (
            <img src={imageUrl} alt={title} className="w-full h-full object-cover" />
          ) : (
            <div className="w-full h-full bg-gradient-to-br from-primary/20 to-primary/5" />
          )}
          {/* Like button */}
          <button
            onClick={handleLikeClick}
            className="absolute top-2 right-2 w-10 h-10 bg-black/60 hover:bg-black/80 rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-all duration-200 hover:scale-110 z-10"
            aria-label={isLiked ? "Unlike playlist" : "Like playlist"}
          >
            <Heart 
              className={`w-5 h-5 transition-all ${
                isLiked 
                  ? "fill-primary text-primary" 
                  : "text-white"
              }`}
            />
          </button>
        </div>
        <h3 className="font-semibold text-foreground mb-1 truncate">{title}</h3>
        <p className="text-sm text-muted-foreground line-clamp-2">{description}</p>
      </div>
    </Link>
  );
};

export default PlaylistCard;
