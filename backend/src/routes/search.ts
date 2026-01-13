// src/lib/api/search.ts

import { useEffect, useState } from "react";

/* ===========================
   Types
=========================== */

export type SearchResultItem = {
  type: "artist" | "song" | "album" | "playlist" | "video";
  id: string;
  title: string;
  subtitle?: string;
  imageUrl?: string;
  isOfficial?: boolean;
};

export type SearchSections = {
  artists: SearchResultItem[];
  songs: SearchResultItem[];
  albums: SearchResultItem[];
  playlists: SearchResultItem[];
};

export type SearchResolveResponse = {
  q: string;
  source: string;
  featured?: SearchResultItem | null;
  orderedItems?: SearchResultItem[];
  sections: SearchSections;
};

export type SearchSuggestItem = {
  id: string;
  title: string;
  subtitle?: string;
  imageUrl?: string;
  type: "artist" | "song" | "album" | "playlist";
};

/* ===========================
   Low-level API calls
=========================== */

const API_BASE = import.meta.env.VITE_BACKEND_URL;

export async function searchResolve(query: string): Promise<SearchResolveResponse> {
  const res = await fetch(`${API_BASE}/api/search/results?q=${encodeURIComponent(query)}`, {
    credentials: "include",
  });

  if (!res.ok) {
    throw new Error("searchResolve failed");
  }

  return res.json();
}

export async function searchSuggest(query: string): Promise<SearchSuggestItem[]> {
  const res = await fetch(`${API_BASE}/api/search/suggest?q=${encodeURIComponent(query)}`, {
    credentials: "include",
  });

  if (!res.ok) {
    return [];
  }

  const json = await res.json();
  return Array.isArray(json.suggestions) ? json.suggestions : [];
}

/* ===========================
   React hook (FIX za build)
=========================== */

export function useSearchResults(query: string) {
  const [data, setData] = useState<SearchResolveResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    if (!query || query.trim().length < 2) {
      setData(null);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setError(null);

    searchResolve(query)
      .then((res) => {
        if (!cancelled) setData(res);
      })
      .catch((err) => {
        if (!cancelled) setError(err);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [query]);

  return {
    data,
    loading,
    error,
  };
}
