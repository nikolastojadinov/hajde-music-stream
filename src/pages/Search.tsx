import { FormEvent, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import YTMusicSearch from "@/components/search/YTMusicSearch";
import SearchSuggestList from "@/components/search/SearchSuggestList";
import {
  searchResolve,
  searchSuggest,
  type SearchSection,
  type SearchSuggestItem,
} from "@/lib/api/search";

const SUGGEST_DEBOUNCE_MS = 250;

export default function Search() {
  const navigate = useNavigate();

  const [query, setQuery] = useState("");
  const [sections, setSections] = useState<SearchSection[]>([]);
  const [suggestions, setSuggestions] = useState<SearchSuggestItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const suggestAbortRef = useRef<AbortController | null>(null);
  const suggestTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearSuggestions = () => {
    suggestAbortRef.current?.abort();
    suggestAbortRef.current = null;
    setSuggestions([]);
  };

  const runSearch = async (value?: string) => {
    const nextQuery = (value ?? query).trim();
    if (nextQuery.length < 2) {
      setSections([]);
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const response = await searchResolve({ q: nextQuery });
      setSections(response?.sections ?? []);
    } catch {
      setError("Unable to load search results.");
      setSections([]);
    } finally {
      setLoading(false);
    }
  };

  const scheduleSuggest = (value: string) => {
    const trimmed = value.trim();

    if (suggestTimeoutRef.current) {
      clearTimeout(suggestTimeoutRef.current);
      suggestTimeoutRef.current = null;
    }

    if (trimmed.length < 2) {
      clearSuggestions();
      return;
    }

    suggestTimeoutRef.current = setTimeout(async () => {
      suggestAbortRef.current?.abort();
      const controller = new AbortController();
      suggestAbortRef.current = controller;

      try {
        const res = await searchSuggest(trimmed, { signal: controller.signal });
        setSuggestions(Array.isArray(res?.suggestions) ? res.suggestions : []);
      } catch (err: any) {
        if (err?.name === "AbortError") return;
        setSuggestions([]);
      }
    }, SUGGEST_DEBOUNCE_MS);
  };

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    clearSuggestions();
    void runSearch();
  };

  const handleInputChange = (value: string) => {
    setQuery(value);
    scheduleSuggest(value);
  };

  const handleSelect = (item: SearchSuggestItem) => {
    clearSuggestions();

    if (item.type === "artist") {
      navigate(`/artist/${encodeURIComponent(item.id)}`);
      return;
    }

    if (item.type === "playlist") {
      navigate(`/playlist/${encodeURIComponent(item.id)}`);
      return;
    }

    setQuery(item.name);
    void runSearch(item.name);
  };

  useEffect(() => {
    return () => {
      if (suggestTimeoutRef.current) {
        clearTimeout(suggestTimeoutRef.current);
      }
      clearSuggestions();
    };
  }, []);

  return (
    <div className="min-h-screen bg-neutral-950 pb-20 text-white">
      <div className="mx-auto max-w-6xl px-4 py-8 space-y-6">
        <form onSubmit={handleSubmit} className="space-y-3">
          <div className="relative flex flex-col gap-3 rounded-xl border border-neutral-800 bg-neutral-900/70 p-4">
            <Input
              value={query}
              onChange={(e) => handleInputChange(e.target.value)}
              placeholder="Search songs, artists, albums..."
              className="border-neutral-700 bg-neutral-950 text-white placeholder:text-neutral-500 focus-visible:ring-neutral-500"
            />

            <div className="flex items-center gap-3">
              <Button
                type="submit"
                className="bg-neutral-100 text-neutral-900 hover:bg-white"
                disabled={loading}
              >
                {loading ? "Searching..." : "Search"}
              </Button>
              <span className="text-xs text-neutral-500">
                Type at least 2 characters to search
              </span>
            </div>

            {suggestions.length > 0 && (
              <div className="absolute left-0 right-0 top-full z-50 mt-2 max-h-80 overflow-y-auto rounded-xl border border-neutral-800 bg-neutral-950/95 shadow-xl">
                <SearchSuggestList suggestions={suggestions} onSelect={handleSelect} />
              </div>
            )}
          </div>
        </form>

        {error && (
          <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-100">
            {error}
          </div>
        )}

        {!loading && sections.length === 0 && !error && (
          <div className="text-sm text-neutral-500">
            Start typing to see results.
          </div>
        )}

        <YTMusicSearch sections={sections} />
      </div>
    </div>
  );
}
