import { Play } from "lucide-react";
import { Link } from "react-router-dom";
import { usePlayer, type PlaybackContext } from "@/contexts/PlayerContext";

interface TrackCardProps {
  id?: string;
  title: string;
  artist: string;
  artistHref?: string | null;
  imageUrl?: string | null;
  youtubeVideoId: string;
  duration?: number | null;
  isActive?: boolean;
  onPlay?: () => void;
  playbackContext?: PlaybackContext;
}

const TrackCard = ({
  id,
  title,
  artist,
  imageUrl,
  youtubeVideoId,
  duration,
  artistHref,
  isActive = false,
  onPlay,
  playbackContext = "song",
}: TrackCardProps) => {
  const { playTrack } = usePlayer();

  const handlePlayClick = () => {
    if (onPlay) {
      onPlay();
    } else {
      playTrack({ youtubeVideoId, title, artist, thumbnailUrl: imageUrl ?? undefined }, playbackContext);
    }
  };

  const formatDuration = (seconds?: number | null) => {
    if (!seconds) return "";
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, "0")}`;
  };

  return (
    <div
      onClick={handlePlayClick}
      className={`
        group
        flex items-stretch
        cursor-pointer
        overflow-hidden
        rounded-[10px]
        border
        transition
        ${
          isActive
            ? "border-[#FF4FB7]/60 bg-[#FF4FB7]/10"
            : "border-white/5 bg-white/5 hover:bg-white/10"
        }
      `}
      data-track-id={id ?? youtubeVideoId}
    >
      <div className="relative w-14 shrink-0 overflow-hidden bg-black">
        {imageUrl ? (
          <img
            src={imageUrl}
            alt={title}
            className="absolute inset-0 w-full h-full object-cover scale-[1.15]"
          />
        ) : (
          <div className="absolute inset-0 bg-gradient-to-br from-[#FF4FB7]/30 via-[#7C3AED]/15 to-[#0E0C16]" />
        )}

        {!isActive && (
          <div className="absolute inset-0 bg-black/45 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
            <Play className="w-5 h-5 text-[#F6C66D] fill-current" />
          </div>
        )}

        {isActive && <div className="absolute inset-0 ring-2 ring-[#FF4FB7]/60 animate-pulse" />}
      </div>

      <div className="flex-1 min-w-0 px-3 py-2">
        <div className="font-medium text-[#F6C66D] truncate leading-tight">
          {title}
        </div>
        {artistHref ? (
          <Link
            to={artistHref}
            onClick={(e) => e.stopPropagation()}
            className="text-sm text-[#9A95B2] truncate leading-tight underline decoration-dotted underline-offset-[3px] hover:text-[#F6C66D]"
          >
            {artist}
          </Link>
        ) : (
          <div className="text-sm text-[#9A95B2] truncate leading-tight">{artist}</div>
        )}
      </div>

      <div className="flex items-center gap-2 pr-3 shrink-0">
        {duration ? (
          <div className="text-xs text-[#B7B2CC] tabular-nums">
            {formatDuration(duration)}
          </div>
        ) : null}
      </div>
    </div>
  );
};

export default TrackCard;
