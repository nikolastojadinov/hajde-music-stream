import { Play } from "lucide-react";
import { Link } from "react-router-dom";
import { usePlayer } from "@/contexts/PlayerContext";

interface PlaylistCardProps {
  id: string | number;
  title: string;
  description: string;
  imageUrl?: string;
}

const PlaylistCard = ({ id, title, description, imageUrl }: PlaylistCardProps) => {
  const { setIsPlayerVisible } = usePlayer();

  const handlePlayClick = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    // TODO: Učitaj prvu pesmu iz playliste
    setIsPlayerVisible(true);
  };

  return (
    <Link
      to={`/playlist/${id}`}
      className="group block"
    >
      <div className="bg-card p-4 rounded-xl hover:bg-secondary/80 transition-all duration-300 overflow-hidden">
        <div className="relative mb-4 aspect-square rounded-lg overflow-hidden bg-muted">
          {imageUrl ? (
            <img src={imageUrl} alt={title} className="w-full h-full object-cover" />
          ) : (
            <div className="w-full h-full bg-gradient-to-br from-primary/20 to-primary/5" />
          )}
          <button 
            onClick={handlePlayClick}
            className="absolute bottom-2 right-2 w-12 h-12 bg-primary rounded-full flex items-center justify-center opacity-0 invisible group-hover:opacity-100 group-hover:visible translate-y-2 group-hover:translate-y-0 transition-all duration-300 hover:scale-105 border-0 outline-none focus:outline-none shadow-none group-hover:shadow-lg pointer-events-none group-hover:pointer-events-auto"
          >
            <Play className="w-5 h-5 text-background fill-current ml-0.5" />
          </button>
        </div>
        <h3 className="font-semibold text-foreground mb-1 truncate">{title}</h3>
        <p className="text-sm text-muted-foreground line-clamp-2">{description}</p>
      </div>
    </Link>
  );
};

export default PlaylistCard;
