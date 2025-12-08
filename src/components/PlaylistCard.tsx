import { Link } from "react-router-dom";
import { Music } from "lucide-react";

interface PlaylistCardProps {
  id: string;
  title: string;
  description: string;
  imageUrl?: string;
}

const PlaylistCard = ({ id, title, description, imageUrl }: PlaylistCardProps) => {
  return (
    <Link to={`/playlist/${id}`} className="group block">
      <div className="bg-card p-3 rounded-lg hover:bg-secondary/80 transition-all duration-300">
        {/* 16:9 cover image container */}
        <div
          className="relative mb-3 w-full rounded-md overflow-hidden bg-black/40"
          style={{ aspectRatio: "16 / 9" }}
        >
          {imageUrl ? (
            <img
              src={imageUrl}
              alt={title}
              className="w-full h-full object-cover"
            />
          ) : (
            <div className="w-full h-full flex items-center justify-center bg-gradient-to-br from-primary/20 to-primary/5">
              <Music className="w-8 h-8 text-primary/30" />
            </div>
          )}
        </div>

        {/* Text area */}
        <div className="space-y-1">
          <h3 className="font-semibold text-sm text-foreground truncate leading-tight">{title}</h3>
          <p className="text-xs text-muted-foreground line-clamp-2 leading-tight min-h-[2.5rem]">
            {description}
          </p>
        </div>
      </div>
    </Link>
  );
};

export default PlaylistCard;
