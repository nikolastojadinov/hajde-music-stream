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
      className="block min-w-[260px]"
    >
      <div
        className="
          flex
          items-stretch
          h-[72px]
          rounded-xl
          bg-[#1C1C1C]
          overflow-hidden
          transition-colors
          hover:bg-[#2A2A2A]
        "
      >
        {/* COVER — FULL HEIGHT, NO PADDING */}
        <div className="w-[72px] h-full bg-black shrink-0">
          {imageUrl ? (
            <img
              src={imageUrl}
              alt={title}
              className="w-full h-full object-cover object-center"
              loading="lazy"
            />
          ) : (
            <div className="w-full h-full flex items-center justify-center bg-[#333]">
              <Music className="w-6 h-6 text-[#CFA85B]" />
            </div>
          )}
        </div>

        {/* TEXT */}
        <div className="flex flex-col justify-center px-3 overflow-hidden">
          <span className="text-sm font-semibold text-white truncate">
            {title}
          </span>
          {description && (
            <span className="text-xs text-[#B3B3B3] truncate">
              {description}
            </span>
          )}
        </div>
      </div>
    </Link>
  );
};

export default PlaylistCard;
