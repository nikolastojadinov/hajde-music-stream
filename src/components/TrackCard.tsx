import { Play, Heart } from "lucide-react";
import { usePlayer } from "@/contexts/PlayerContext";
import AddToPlaylistButton from "@/components/AddToPlaylistButton";

interface TrackCardProps {
  id: string;
  title: string;
  artist: string;
  imageUrl?: string | null;
  youtubeId: string;
  duration?: number | null;

  /* === NOVO (minimalno, obavezno) === */
  isActive?: boolean;
  onPlay?: () => void;

  liked?: boolean;
  onToggleLike?: (trackId: string) => Promise<void> | void;
}

const TrackCard = ({
  id,
  title,
  artist,
  imageUrl,
  youtubeId,
  duration,
  isActive = false,
  onPlay,
  liked = false,
  onToggleLike,
}: TrackCardProps) => {
  const { playTrack } = usePlayer();

  const handlePlayClick = () => {
    if (onPlay) {
      onPlay();
    } else {
      playTrack(youtubeId, title, artist, id);
    }
  };

  const handleLikeClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!onToggleLike) return;
    void onToggleLike(id);
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
    >
      {/* ===== COVER ===== */}
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

        {/* PLAY OVERLAY (hover) */}
        {!isActive && (
          <div className="absolute inset-0 bg-black/45 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
            <Play className="w-5 h-5 text-[#F6C66D] fill-current" />
          </div>
        )}

        {/* ACTIVE ANIMATION */}
        {isActive && (
          <div className="absolute inset-0 ring-2 ring-[#FF4FB7]/60 animate-pulse" />
        )}
      </div>

      {/* ===== TEXT ===== */}
      <div className="flex-1 min-w-0 px-3 py-2">
        <div className="font-medium text-[#F6C66D] truncate leading-tight">
          {title}
        </div>
        <div className="text-sm text-[#9A95B2] truncate leading-tight">
          {artist}
        </div>
      </div>

      {/* ===== ACTIONS ===== */}
      <div className="flex items-center gap-2 pr-3 shrink-0">
        <AddToPlaylistButton
          trackId={id}
          trackTitle={title}
          variant="ghost"
          iconSize={16}
        />

        <button
          onClick={handleLikeClick}
          className="p-1"
          aria-label={liked ? "Unlike song" : "Like song"}
        >
          <Heart
            className={`w-4 h-4 ${
              liked
                ? "fill-primary text-primary"
                : "text-muted-foreground hover:text-foreground"
            }`}
          />
        </button>

        {duration && (
          <div className="text-xs text-[#B7B2CC] tabular-nums">
            {formatDuration(duration)}
          </div>
        )}
      </div>
    </div>
  );
};

export default TrackCard;
