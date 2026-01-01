import { Link } from "react-router-dom";
import { Music } from "lucide-react";

interface PlaylistCardProps {
  id: string;
  title: string;
  description: string;
  imageUrl?: string;
  linkState?: unknown;
}

export default function PlaylistCard({
  id,
  title,
  description,
  imageUrl,
  linkState,
}: PlaylistCardProps) {
  return (
    <Link to={`/playlist/${id}`} state={linkState} className="block">
      {/* CARD */}
      <div className="overflow-hidden rounded-[18px] bg-[rgba(20,17,38,0.6)] shadow-[0_8px_24px_rgba(0,0,0,0.45)] transition-all duration-300 hover:shadow-[0_12px_30px_rgba(0,0,0,0.55)]">

        {/* IMAGE — FULL WIDTH, NO PADDING, NO MARGINS */}
        <div className="relative w-full aspect-square bg-black">
          {imageUrl ? (
            <img
              src={imageUrl}
              alt={title}
              className="absolute inset-0 w-full h-full object-cover"
            />
          ) : (
            <div className="absolute inset-0 flex items-center justify-center bg-gradient-to-br from-[#FF4FB7]/20 via-[#7C3AED]/10 to-[#0E0C16]">
              <Music className="w-10 h-10 text-[#CFA85B]" />
            </div>
          )}
        </div>

        {/* TEXT AREA — JEDINI DEO SA PADDINGOM */}
        <div className="px-4 pt-3 pb-4">
          <h3 className="font-semibold text-sm text-[#F6C66D] truncate">
            {title}
          </h3>
          <p className="mt-1 text-xs text-[#B7B2CC] line-clamp-2 leading-tight">
            {description}
          </p>
        </div>
      </div>
    </Link>
  );
}
