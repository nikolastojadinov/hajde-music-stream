import { AlertCircle, RefreshCcw } from "lucide-react";
import { useNavigate } from "react-router-dom";

import PlaylistListItem from "@/components/PlaylistListItem";
import { MostPopularSnapshot } from "@/lib/api/home";
import { adaptMostPopularSnapshotItem } from "@/lib/adapters/playlists";

type Props = {
  snapshot: MostPopularSnapshot | null;
  loading: boolean;
  error?: string | null;
  onRetry?: () => void;
};

const formatUpdatedAt = (iso: string | null): string => {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return `${date.toUTCString()}`;
};

const skeletonItems = Array.from({ length: 6 });

export default function MostPopularSection({ snapshot, loading, error, onRetry }: Props) {
  const normalizedItems = (snapshot?.items || [])
    .map(adaptMostPopularSnapshotItem)
    .filter(Boolean);

  const hasItems = normalizedItems.length > 0;
  const updatedLabel = snapshot ? formatUpdatedAt(snapshot.generated_at) : "";
  const navigate = useNavigate();

  return (
    <section className="relative mx-auto mt-10 w-full max-w-6xl rounded-2xl px-3 py-5 sm:px-6">
      <div className="mb-5 flex items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-[#F6C66D]">Most Popular</h2>
        </div>
        <div className="flex items-center gap-2 text-[11px] text-white/50">
          {updatedLabel ? <span className="hidden sm:inline">Osveženo: {updatedLabel}</span> : null}
          {loading ? (
            <span className="flex items-center gap-1"><RefreshCcw className="h-4 w-4 animate-spin" /> Učitavanje</span>
          ) : null}
        </div>
      </div>

      {error ? (
        <div className="mb-4 flex items-center justify-between rounded-lg border border-red-500/30 bg-red-500/5 px-4 py-3 text-sm text-red-100">
          <div className="flex items-center gap-2">
            <AlertCircle className="h-4 w-4" />
            <span>{error}</span>
          </div>
          {onRetry ? (
            <button
              type="button"
              onClick={onRetry}
              className="flex items-center gap-2 rounded-full border border-red-500/40 px-3 py-1 text-xs font-semibold uppercase tracking-wide text-red-100 transition hover:bg-red-500/10"
            >
              <RefreshCcw className="h-3 w-3" />
              Pokušaj ponovo
            </button>
          ) : null}
        </div>
      ) : null}

      <div className="flex flex-col gap-2">
        {loading
          ? skeletonItems.map((_, idx) => (
              <div
                key={`skeleton-${idx}`}
                className="flex items-center gap-3 rounded-lg border border-white/5 bg-white/5 px-3 py-2 animate-pulse"
              >
                <div className="h-12 w-12 rounded-lg bg-white/10" />
                <div className="flex-1 space-y-2">
                  <div className="h-4 w-2/3 rounded bg-white/10" />
                  <div className="h-3 w-1/2 rounded bg-white/10" />
                </div>
                <div className="h-5 w-16 rounded-full bg-white/10" />
              </div>
            ))
          : null}

        {!loading && hasItems
          ? normalizedItems.map((item) =>
              item ? (
                <PlaylistListItem
                  key={item.browseId}
                  title={item.title}
                  subtitle={item.subtitle}
                  imageUrl={item.imageUrl}
                  badge={item.badge}
                  onSelect={() =>
                    navigate(`/playlist/${encodeURIComponent(item.browseId)}`, {
                      state: item.navState,
                    })
                  }
                />
              ) : null,
            )
          : null}

        {!loading && !hasItems && !error ? (
          <div className="w-full rounded-lg border border-white/10 bg-black/20 px-4 py-6 text-sm text-white/70">
            Trenutno nema dovoljno podataka za Most Popular. Svratite uskoro.
          </div>
        ) : null}
      </div>
    </section>
  );
}
