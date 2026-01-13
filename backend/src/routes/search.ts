import { useEffect, useState } from "react";

const BACKEND_URL =
  import.meta.env.VITE_BACKEND_URL ||
  import.meta.env.VITE_API_URL ||
  "";

export type SearchItemType =
  | "song"
  | "video"
  | "artist"
  | "album"
  | "playlist";

export interface SearchItem {
  type: SearchItemType;
  id: string;
  title: string;
  subtitle?: string;
  imageUrl?: string;
  isOfficial?: boolean;
}

export interface SearchResults {
  q: string;
  source: string;
  orderedItems: SearchItem[];
  sections?: {
    songs?: SearchItem[];
    artists?: SearchItem[];
    albums?: SearchItem[];
    playlists?: SearchItem[];
  };
  featured?: SearchItem | null;
}

/**
 * React hook used by Search.tsx
 */
export function useSearchResults(query: string) {
  const [data, setData] = useState<SearchResults | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!query || query.trim().length < 2) {
      setData(null);
      return;
    }

    const controller = new AbortController();

    async function run() {
      setLoading(true);
      setError(null);

      try {
        const res = await fetch(
          `${BACKEND_URL}/api/search/results?q=${encodeURIComponent(query)}`,
          {
            signal: controller.signal,
            headers: {
              Accept: "application/json",
            },
          }
        );

        if (!res.ok) {
          throw new Error(`Search request failed (${res.status})`);
        }

        const json = await res.json();
        setData(json);
      } catch (err: any) {
        if (err.name === "AbortError") return;
        setError(err.message || "Search failed");
      } finally {
        setLoading(false);
      }
    }

    run();

    return () => controller.abort();
  }, [query]);

  return {
    data,
    loading,
    error,
  };
}
