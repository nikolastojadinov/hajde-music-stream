import { Link } from "react-router-dom";
import { Music } from "lucide-react";

interface PlaylistCardProps {
  id: string;
  title: string;
  description: string;
  imageUrl?: string;
  linkState?: unknown;
}

const PlaylistCard = ({ id, title, description, imageUrl, linkState }: PlaylistCardProps) => {
  return (
    <Link to={`/playlist/${id}`} state={linkState} className="group block">
      <div className="rounded-[18px] border border-[rgba(255,255,255,0.08)] bg-[rgba(20,17,38,0.6)] p-4 backdrop-blur-xl shadow-[0_8px_24px_rgba(0,0,0,0.45)] transition-all duration-300 hover:border-[rgba(246,198,109,0.45)] hover:shadow-[0_12px_30px_rgba(0,0,0,0.55)]">
        <div className="relative mb-3 w-full h-28 rounded-xl bg-black/30 overflow-hidden flex items-center justify-center">
          {imageUrl ? (
            <img
              src={imageUrl}
              alt={title}
              className="max-w-full max-h-full object-cover object-center"
            />
          ) : (
            <div className="w-full h-full flex items-center justify-center bg-gradient-to-br from-[#FF4FB7]/20 via-[#7C3AED]/10 to-[#0E0C16]">
              <Music className="w-8 h-8 text-[#CFA85B]" />
            </div>
          )}
        </div>

        <div className="space-y-1">
          <h3 className="font-semibold text-sm text-[#F6C66D] truncate leading-tight">{title}</h3>
          <p className="text-xs text-[#B7B2CC] line-clamp-2 leading-tight min-h-[2.5rem]">
            {description}
          </p>
        </div>
      </div>
    </Link>
  );
};

export default PlaylistCard;
