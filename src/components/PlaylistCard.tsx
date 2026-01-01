import { Link } from "react-router-dom";
import { Music } from "lucide-react";

interface PlaylistCardProps {
  id: string;
  title: string;
  description: string;
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
    <Link to={`/playlist/${id}`} state={linkState} className="block">
      <div
        className="
          h-[300px]
          rounded-[18px]
          overflow-hidden
          border border-[rgba(255,255,255,0.08)]
          bg-[rgba(20,17,38,0.6)]
          backdrop-blur-xl
          shadow-[0_8px_24px_rgba(0,0,0,0.45)]
          transition-all duration-300
          hover:border-[rgba(246,198,109,0.45)]
          hover:shadow-[0_12px_30px_rgba(0,0,0,0.55)]
        "
      >
        {/* COVER — FULL WIDTH, NO PADDING, TOUCHES EDGES */}
        <div className="w-full h-[180px] bg-[rgba(20,17,38,0.6)]">
          {imageUrl ? (
            <img
              src={imageUrl}
              alt={title}
              className="w-full h-full object-contain"
            />
          ) : (
            <div className="w-full h-full flex items-center justify-center">
              <Music className="w-10 h-10 text-[#CFA85B]" />
            </div>
          )}
        </div>

        {/* TEXT — ONLY AREA WITH PADDING */}
        <div className="p-4">
          <h3 className="font-semibold text-sm text-[#F6C66D] truncate">
            {title}
          </h3>
          <p className="text-xs text-[#B7B2CC] line-clamp-2 mt-1">
            {description}
          </p>
        </div>
      </div>
    </Link>
  );
};

export default PlaylistCard;
