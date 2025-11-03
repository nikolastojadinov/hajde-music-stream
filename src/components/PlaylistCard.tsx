import { Play } from "lucide-react";
import { Link } from "react-router-dom";

interface PlaylistCardProps {
  id: number;
  title: string;
  description: string;
  imageUrl?: string;
}

const PlaylistCard = ({ id, title, description, imageUrl }: PlaylistCardProps) => {
  return (
    <Link
      to={`/playlist/${id}`}
      className="group relative bg-card p-4 rounded-xl hover:bg-secondary/80 transition-all duration-300 cursor-pointer"
    >
      <div className="relative mb-4 aspect-square rounded-lg overflow-hidden bg-gradient-to-br from-primary/20 to-primary/5">
        {imageUrl && (
          <img src={imageUrl} alt={title} className="w-full h-full object-cover" />
        )}
        <div className="absolute inset-0 bg-gradient-to-t from-background/60 to-transparent opacity-0 group-hover:opacity-100 transition-opacity" />
        <button className="absolute bottom-2 right-2 w-12 h-12 bg-primary rounded-full flex items-center justify-center shadow-lg opacity-0 group-hover:opacity-100 translate-y-2 group-hover:translate-y-0 transition-all duration-300 hover:scale-105">
          <Play className="w-5 h-5 text-background fill-current ml-0.5" />
        </button>
      </div>
      <h3 className="font-semibold text-foreground mb-1 truncate">{title}</h3>
      <p className="text-sm text-muted-foreground line-clamp-2">{description}</p>
    </Link>
  );
};

export default PlaylistCard;
