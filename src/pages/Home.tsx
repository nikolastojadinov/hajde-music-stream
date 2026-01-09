import { useEffect, useState } from "react";
import { Search as SearchIcon } from "lucide-react";
import { useNavigate } from "react-router-dom";
import Footer from "@/components/Footer";
import Header from "@/components/Header";
import TrendingNowSection from "@/components/home/TrendingNowSection";
import { fetchTrendingNowSnapshot, type TrendingSnapshot } from "@/lib/api/home";

export default function Home() {
  const navigate = useNavigate();

  const [trendingSnapshot, setTrendingSnapshot] = useState<TrendingSnapshot | null>(null);
  const [loadingTrending, setLoadingTrending] = useState(true);
  const [trendingError, setTrendingError] = useState<string | null>(null);

  const goToSearch = () => navigate("/search");

  const loadTrending = (controller?: AbortController) => {
    setLoadingTrending(true);
    setTrendingError(null);

    fetchTrendingNowSnapshot({ signal: controller?.signal })
      .then((snapshot) => {
        setTrendingSnapshot(snapshot);
      })
      .catch((err: any) => {
        if (controller?.signal?.aborted) return;
        console.warn("[Home] trending load failed", err?.message || err);
        setTrendingSnapshot(null);
        setTrendingError("Nije moguće učitati Trending Now sekciju.");
      })
      .finally(() => {
        if (controller?.signal?.aborted) return;
        setLoadingTrending(false);
      });
  };

  useEffect(() => {
    const controller = new AbortController();
    loadTrending(controller);
    return () => controller.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="flex min-h-screen flex-col">
      <Header />
      <main className="flex-1 pb-24">
        <div className="mx-auto max-w-6xl px-4 pt-4 md:px-6">
          <div className="overflow-hidden rounded-2xl border border-white/5 bg-gradient-to-r from-[#0B0A0F] via-[#0C0F17] to-[#0A0E1A] p-6 shadow-[0_18px_44px_rgba(0,0,0,0.45)]">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-xs uppercase tracking-[0.2em] text-white/50">Soundscape</p>
                <h1 className="mt-1 text-xl font-semibold text-white">Pronađi sledeću plejlistu</h1>
              </div>
              <button
                type="button"
                onClick={goToSearch}
                className="group relative flex h-11 min-w-[220px] items-center justify-between rounded-full border border-white/10 bg-white/5 px-4 text-left text-sm text-white transition hover:border-amber-400/70 hover:bg-white/10"
                aria-label="Otvori pretragu"
              >
                <span className="text-white/80">Traži pesme, izvođače, albume...</span>
                <span className="flex h-8 w-8 items-center justify-center rounded-full bg-amber-400/90 text-black shadow-lg shadow-amber-400/40 transition group-hover:scale-105">
                  <SearchIcon className="h-4 w-4" />
                </span>
              </button>
            </div>
          </div>

          <TrendingNowSection
            snapshot={trendingSnapshot}
            loading={loadingTrending}
            error={trendingError}
            onRetry={() => loadTrending()}
          />
        </div>
      </main>
      <Footer />
    </div>
  );
}
