import { Link } from "react-router-dom";
import { Music } from "lucide-react";

interface PlaylistCardProps {
  id: string;
  title: string;
  description?: string;
  imageUrl?: string;
  linkState?: unknown;
}

const PlaylistCard = ({
  id,
  title,
  description,
  imageUrl,
  linkState,
}: PlaylistCardProps) => {
  return (
    <Link
      to={`/playlist/${id}`}
      state={linkState}
      className="block w-[160px]"
    >
      <div className="rounded-xl bg-[#141414] overflow-hidden">
        {/* COVER IMAGE — FULL WIDTH, FIXED RATIO */}
        <div className="relative w-full aspect-square bg-black">
          {imageUrl ? (
            <img
              src={imageUrl}
              alt={title}
              className="absolute inset-0 w-full h-full object-cover"
              loading="lazy"
            />
          ) : (
            <div className="absolute inset-0 flex items-center justify-center bg-[#222]">
              <Music className="w-8 h-8 text-[#CFA85B]" />
            </div>
          )}
        </div>

        {/* TEXT AREA */}
        <div className="px-3 py-2">
          <p className="text-sm font-semibold text-white truncate">
            {title}
          </p>
          {description && (
            <p className="text-xs text-[#B3B3B3] line-clamp-2">
              {description}
            </p>
          )}
        </div>
      </div>
    </Link>
  );
};

export default PlaylistCard;
