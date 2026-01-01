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
    <Link to={`/playlist/${id}`} state={linkState} className="block w-[160px] shrink-0">
      <div className="rounded-2xl bg-[#12101D] overflow-hidden transition-transform duration-200 hover:scale-[1.03]">
        
        {/* COVER — EDGE TO EDGE, FIXED RATIO */}
        <div className="relative w-full aspect-square bg-black">
          {imageUrl ? (
            <img
              src={imageUrl}
              alt={title}
              className="absolute inset-0 w-full h-full object-cover object-center"
              loading="lazy"
            />
          ) : (
            <div className="absolute inset-0 flex items-center justify-center bg-[#1A1630]">
              <Music className="w-10 h-10 text-[#CFA85B]" />
            </div>
          )}
        </div>

        {/* TEXT AREA — MINIMAL */}
        <div className="px-3 pt-2 pb-3">
          <h3 className="text-sm font-semibold text-[#F6C66D] truncate">
            {title}
          </h3>

          {description && (
            <p className="mt-1 text-xs text-[#B7B2CC] line-clamp-2 leading-snug">
              {description}
            </p>
          )}
        </div>
      </div>
    </Link>
  );
};

export default PlaylistCard;
