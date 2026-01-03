import { Link } from "react-router-dom";
import { Music, Heart, Eye } from "lucide-react";

type PlaylistLikeView = {
  like_count?: number | null;
  view_count?: number | null;
  public_like_count?: number | null;
  public_view_count?: number | null;
};

type PlaylistCardProps =
  | {
      playlist: {
        id: string;
        title?: string | null;
        description?: string | null;
        cover_url?: string | null;
        image_url?: string | null;
      } & PlaylistLikeView;
      linkState?: unknown;
    }
  | {
      id: string;
      title: string;
      description?: string | null;
      imageUrl?: string;
      likeCount?: number | null;
      viewCount?: number | null;
      linkState?: unknown;
    };

const formatCompact = (value: number) =>
  new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 }).format(value);

const PlaylistCard = (props: PlaylistCardProps) => {
  const normalized = "playlist" in props
    ? {
        id: props.playlist.id,
        title: props.playlist.title ?? "",
        description: props.playlist.description ?? "",
        imageUrl: props.playlist.cover_url ?? props.playlist.image_url ?? undefined,
        likeCount: props.playlist.like_count ?? props.playlist.public_like_count ?? undefined,
        viewCount: props.playlist.view_count ?? props.playlist.public_view_count ?? undefined,
        linkState: props.linkState,
      }
    : {
        id: props.id,
        title: props.title,
        description: props.description ?? "",
        imageUrl: props.imageUrl,
        likeCount: props.likeCount,
        viewCount: props.viewCount,
        linkState: props.linkState,
      };

  const likeCount = Math.max(0, normalized.likeCount ?? 0);
  const viewCount = Math.max(0, normalized.viewCount ?? 0);
  const description = (normalized.description ?? "").trim();
  const showDescription = description.length > 0;

  return (
    <Link to={`/playlist/${normalized.id}`} state={normalized.linkState} className="group block">
      <div className="overflow-hidden rounded-[6px] border border-[rgba(255,255,255,0.08)] bg-[rgba(20,17,38,0.6)] backdrop-blur-xl shadow-[0_8px_24px_rgba(0,0,0,0.45)] transition-all duration-300 hover:border-[rgba(246,198,109,0.45)] hover:shadow-[0_12px_30px_rgba(0,0,0,0.55)]">
        <div className="relative w-full aspect-square bg-black/30 overflow-hidden rounded-[4px]">
          {normalized.imageUrl ? (
            <img
              src={normalized.imageUrl}
              alt={normalized.title}
              className="absolute inset-0 w-full h-full object-cover object-center scale-[1.36]"
              loading="lazy"
              decoding="async"
            />
          ) : (
            <div className="absolute inset-0 flex items-center justify-center bg-gradient-to-br from-[#FF4FB7]/20 via-[#7C3AED]/10 to-[#0E0C16]">
              <Music className="w-8 h-8 text-[#CFA85B]" />
            </div>
          )}
        </div>

        <div className="px-4 pt-3 pb-4 h-[72px] flex flex-col justify-between">
          <h3 className="font-semibold text-sm text-[#F6C66D] truncate leading-tight">{normalized.title}</h3>
          {showDescription ? (
            <p className="text-[11px] text-white/75 truncate leading-tight">{description}</p>
          ) : null}
          <div className="flex items-center justify-between text-[11px] text-[#B7B2CC] leading-none">
            <span className="flex items-center gap-1">
              <Heart className="h-3 w-3 opacity-80" />
              <span>{formatCompact(likeCount)}</span>
            </span>
            <span className="flex items-center gap-1">
              <Eye className="h-3 w-3 opacity-80" />
              <span>{formatCompact(viewCount)}</span>
            </span>
          </div>
        </div>
      </div>
    </Link>
  );
};

export default PlaylistCard;
