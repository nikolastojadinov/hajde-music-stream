import { useEffect, useState } from "react";
import { Search as SearchIcon } from "lucide-react";
import { useNavigate } from "react-router-dom";
import Footer from "@/components/Footer";
import Header from "@/components/Header";
import MostPopularSection from "@/components/home/MostPopularSection";
import TrendingNowSection from "@/components/home/TrendingNowSection";
import {
  fetchMostPopularSnapshot,
  fetchTrendingNowSnapshot,
  type MostPopularSnapshot,
  type TrendingSnapshot,
} from "@/lib/api/home";

export default function Home() {
  const navigate = useNavigate();

  const [trendingSnapshot, setTrendingSnapshot] = useState<TrendingSnapshot | null>(null);
  const [loadingTrending, setLoadingTrending] = useState(true);
  const [trendingError, setTrendingError] = useState<string | null>(null);

  const [popularSnapshot, setPopularSnapshot] = useState<MostPopularSnapshot | null>(null);
  const [loadingPopular, setLoadingPopular] = useState(true);
  const [popularError, setPopularError] = useState<string | null>(null);

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

  const loadMostPopular = (controller?: AbortController) => {
    setLoadingPopular(true);
    setPopularError(null);

    fetchMostPopularSnapshot({ signal: controller?.signal })
      .then((snapshot) => {
        setPopularSnapshot(snapshot);
      })
      .catch((err: any) => {
        if (controller?.signal?.aborted) return;
        console.warn("[Home] most-popular load failed", err?.message || err);
        setPopularSnapshot(null);
        setPopularError("Nije moguće učitati Most Popular sekciju.");
      })
      .finally(() => {
        if (controller?.signal?.aborted) return;
        setLoadingPopular(false);
      });
  };

  useEffect(() => {
    const trendingController = new AbortController();
    const popularController = new AbortController();
    loadTrending(trendingController);
    loadMostPopular(popularController);
    return () => {
      trendingController.abort();
      popularController.abort();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="flex min-h-screen flex-col">
      <Header />
      <main className="flex-1 pb-24">
        <div className="mx-auto max-w-5xl px-4 pt-4 md:px-6">
          <button
            type="button"
            onClick={goToSearch}
            className="relative flex h-11 w-full items-center rounded-full border border-neutral-800 bg-neutral-900/85 pl-4 pr-11 text-left text-sm text-neutral-400 transition hover:bg-neutral-900"
            aria-label="Otvori pretragu"
          >
            Traži pesme, izvođače, albume...
            <SearchIcon className="absolute right-4 top-1/2 h-5 w-5 -translate-y-1/2 text-neutral-500" />
          </button>
        </div>

        <div className="mx-auto max-w-6xl px-0 pt-6 md:px-0">
          <TrendingNowSection
            snapshot={trendingSnapshot}
            loading={loadingTrending}
            error={trendingError}
            onRetry={() => loadTrending()}
          />
          <MostPopularSection
            snapshot={popularSnapshot}
            loading={loadingPopular}
            error={popularError}
            onRetry={() => loadMostPopular()}
          />
        </div>
      </main>
      <Footer />
    </div>
  );
}
