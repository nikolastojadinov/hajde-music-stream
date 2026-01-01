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
    <Link to={`/playlist/${id}`} state={linkState} className="group block">
      <div className="overflow-hidden rounded-[6px] border border-[rgba(255,255,255,0.08)] bg-[rgba(20,17,38,0.6)] backdrop-blur-xl shadow-[0_8px_24px_rgba(0,0,0,0.45)] transition-all duration-300 hover:border-[rgba(246,198,109,0.45)] hover:shadow-[0_12px_30px_rgba(0,0,0,0.55)]">
        
        {/* COVER — full width, fixed aspect, STRONGER zoom */}
        <div className="relative w-full aspect-square bg-black/30 overflow-hidden rounded-[4px]">
          {imageUrl ? (
            <img
              src={imageUrl}
              alt={title}
              className="absolute inset-0 w-full h-full object-cover object-center scale-[1.28]"
              loading="lazy"
              decoding="async"
            />
          ) : (
            <div className="absolute inset-0 flex items-center justify-center bg-gradient-to-br from-[#FF4FB7]/20 via-[#7C3AED]/10 to-[#0E0C16]">
              <Music className="w-8 h-8 text-[#CFA85B]" />
            </div>
          )}
        </div>

        {/* TEXT — fixed height so all cards stay equal */}
        <div className="px-4 pt-3 pb-4 h-[72px]">
          <h3 className="font-semibold text-sm text-[#F6C66D] truncate leading-tight">
            {title}
          </h3>
          <p className="mt-1 text-xs text-[#B7B2CC] line-clamp-2 leading-tight">
            {description}
          </p>
        </div>
      </div>
    </Link>
  );
};

export default PlaylistCard;
