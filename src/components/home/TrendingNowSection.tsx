import { AlertCircle, RefreshCcw } from "lucide-react";

import PlaylistCard from "@/components/PlaylistCard";
import { TrendingSnapshot } from "@/lib/api/home";

type Props = {
  snapshot: TrendingSnapshot | null;
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

const skeletonCards = Array.from({ length: 6 });

export default function TrendingNowSection({ snapshot, loading, error, onRetry }: Props) {
  const hasItems = (snapshot?.items?.length ?? 0) > 0;
  const updatedLabel = snapshot ? formatUpdatedAt(snapshot.generated_at) : "";

  return (
    <section className="relative mx-auto mt-10 w-full max-w-6xl rounded-2xl border border-white/5 bg-gradient-to-r from-[#0D0B14] via-[#0C1424] to-[#0D0F1C] p-6 shadow-[0_24px_60px_rgba(0,0,0,0.45)]">
      <div className="mb-5 flex items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-white">Trending Now</h2>
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

      <div className="grid gap-4 pb-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
        {loading
          ? skeletonCards.map((_, idx) => (
              <div
                key={`skeleton-${idx}`}
                className="w-full animate-pulse rounded-[10px] border border-white/5 bg-white/5 p-3"
              >
                <div className="mb-3 h-40 w-full rounded-md bg-white/10" />
                <div className="mb-2 h-4 w-3/4 rounded bg-white/10" />
                <div className="h-3 w-1/2 rounded bg-white/10" />
              </div>
            ))
          : null}

        {!loading && hasItems
          ? snapshot?.items.map((item) => (
              <PlaylistCard
                key={item.id}
                id={item.id}
                title={item.title}
                description={item.subtitle}
                imageUrl={item.imageUrl ?? undefined}
                viewCount={item.metrics?.views_7d}
                linkState={{ from: "home-trending" }}
              />
            ))
          : null}

        {!loading && !hasItems && !error ? (
          <div className="w-full rounded-lg border border-white/10 bg-black/20 px-4 py-6 text-sm text-white/70">
            Trenutno nema dovoljno podataka za Trending Now. Svratite uskoro.
          </div>
        ) : null}
      </div>
    </section>
  );
}
