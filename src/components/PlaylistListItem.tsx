import { Music, MoreHorizontal } from "lucide-react";
import type { ReactNode } from "react";

export type PlaylistListItemProps = {
  title: string;
  subtitle?: string | null;
  imageUrl?: string | null;
  badge?: string | null;
  onSelect?: () => void;
  trailingIcon?: ReactNode;
};

export default function PlaylistListItem({
  title,
  subtitle,
  imageUrl,
  badge,
  onSelect,
  trailingIcon,
}: PlaylistListItemProps) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className="flex w-full items-center gap-3 rounded-lg px-2 py-2 text-left transition hover:bg-neutral-900"
    >
      <div className="h-12 w-12 overflow-hidden rounded-lg bg-neutral-800">
        {imageUrl ? (
          <img src={imageUrl} alt={title} className="h-full w-full object-cover" loading="lazy" decoding="async" />
        ) : (
          <div className="flex h-full w-full items-center justify-center bg-gradient-to-br from-[#FF4FB7]/20 via-[#7C3AED]/10 to-[#0E0C16]">
            <Music className="h-5 w-5 text-[#CFA85B]" />
          </div>
        )}
      </div>

      <div className="min-w-0 flex-1">
        <div className="truncate font-semibold text-neutral-50">{title}</div>
        {subtitle ? <div className="truncate text-xs text-neutral-400">{subtitle}</div> : null}
      </div>

      {badge ? <span className="rounded-full bg-neutral-800 px-2 py-1 text-xs text-neutral-200">{badge}</span> : null}

      {trailingIcon ?? <MoreHorizontal className="h-5 w-5 text-neutral-400" />}
    </button>
  );
}
