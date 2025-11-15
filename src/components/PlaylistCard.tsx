import { Link } from "react-router-dom";

interface PlaylistCardProps {
  id: string;
  title: string;
  description: string;
  imageUrl?: string;
}

const PlaylistCard = ({ id, title, description, imageUrl }: PlaylistCardProps) => {

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
        </div>
        <h3 className="font-semibold text-foreground mb-1 truncate">{title}</h3>
        <p className="text-sm text-muted-foreground line-clamp-2">{description}</p>
      </div>
    </Link>
  );
};

export default PlaylistCard;
