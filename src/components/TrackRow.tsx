import { Music } from "lucide-react";

type Props = {
  index: number;
  title: string;
  artist?: string;
  duration?: string;
  onSelect?: () => void;
};

export function TrackRow({ index, title, artist, duration, onSelect }: Props) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className="flex w-full items-center gap-4 px-6 py-4 text-left transition hover:bg-white/5"
    >
      <div className="w-6 shrink-0 text-center text-xs font-semibold text-neutral-400">{index + 1}</div>
      <div className="flex h-14 w-14 items-center justify-center overflow-hidden rounded-md bg-neutral-800 shadow-inner">
        <Music className="h-6 w-6 text-white/40" aria-hidden="true" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-semibold text-white">{title || ""}</div>
        {artist ? <div className="truncate text-xs text-neutral-400">{artist}</div> : null}
      </div>
      <div className="shrink-0 text-xs tabular-nums text-neutral-300">{duration || ""}</div>
    </button>
  );
}
