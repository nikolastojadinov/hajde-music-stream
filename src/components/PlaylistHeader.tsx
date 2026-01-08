import { Play, Shuffle } from "lucide-react";

type Props = {
  title: string;
  thumbnail: string | null;
  trackCount: number;
  onPlayAll?: () => void;
  onShuffle?: () => void;
  disablePlayback?: boolean;
};

export function PlaylistHeader({ title, thumbnail, trackCount, onPlayAll, onShuffle, disablePlayback }: Props) {
  return (
    <div className="relative overflow-hidden rounded-2xl border border-white/10 bg-gradient-to-br from-neutral-900/90 via-neutral-900/70 to-black shadow-2xl">
      <div className="relative flex flex-col gap-6 p-6 md:flex-row md:items-center md:gap-8 md:p-10">
        {thumbnail ? (
          <div className="aspect-square w-56 overflow-hidden rounded-[10px] border border-white/10 bg-neutral-900 shadow-xl md:w-64">
            <img src={thumbnail} alt={title} className="h-full w-full object-cover" />
          </div>
        ) : null}

        <div className="flex flex-1 flex-col gap-4">
          <div className="text-xs uppercase tracking-[0.3em] text-white/70">Playlist</div>
          <h1 className="text-3xl font-black leading-tight text-white sm:text-4xl">{title}</h1>
          <div className="flex flex-wrap items-center gap-3 text-sm text-neutral-300">
            <span className="font-semibold text-white">YouTube Music</span>
            <span className="h-1 w-1 rounded-full bg-neutral-500" aria-hidden="true" />
            <span>{trackCount} songs</span>
          </div>

          <div className="flex flex-wrap items-center gap-3 pt-2">
            <button
              type="button"
              onClick={onPlayAll}
              disabled={disablePlayback}
              className="flex h-14 w-14 items-center justify-center rounded-full bg-white text-neutral-900 shadow-lg transition hover:scale-105 disabled:cursor-not-allowed disabled:opacity-50"
              aria-label="Play playlist"
            >
              <Play className="h-7 w-7" />
            </button>
            <button
              type="button"
              onClick={onShuffle}
              disabled={disablePlayback}
              className="flex h-12 items-center gap-2 rounded-full border border-white/20 bg-white/10 px-4 text-sm font-semibold text-white hover:bg-white/20 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <Shuffle className="h-4 w-4" /> Shuffle
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
