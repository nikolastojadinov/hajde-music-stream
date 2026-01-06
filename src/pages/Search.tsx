import { FormEvent, useEffect, useRef, useState } from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import YTMusicSearch from "@/components/search/YTMusicSearch";
import { searchResolve, searchSuggest, type SearchSection, type SearchSuggestItem } from "@/lib/api/search";

export default function Search() {
  const [query, setQuery] = useState("");
  const [sections, setSections] = useState<SearchSection[]>([]);
  const [suggestions, setSuggestions] = useState<SearchSuggestItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const suggestAbortRef = useRef<AbortController | null>(null);
  const suggestTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const SUGGEST_DEBOUNCE_MS = 250;

  const runSearch = async (value?: string) => {
    const nextQuery = (value ?? query).trim();
    if (nextQuery.length < 2) return;

    setLoading(true);
    setError(null);

    try {
      const response = await searchResolve({ q: nextQuery });
      setSections(response?.sections ?? []);
    } catch (err) {
      console.error("Search failed", err);
      setError("Unable to load search results.");
      setSections([]);
    } finally {
      setLoading(false);
    }
  };

  const clearSuggestions = () => {
    suggestAbortRef.current?.abort();
    suggestAbortRef.current = null;
    setSuggestions([]);
  };

  const triggerSuggest = (value: string) => {
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
        const response = await searchSuggest(trimmed, { signal: controller.signal });
        setSuggestions(Array.isArray(response?.suggestions) ? response.suggestions : []);
      } catch (err: any) {
        if (err?.name === "AbortError") return;
        console.warn("Search suggest failed", err);
        setSuggestions([]);
      }
    }, SUGGEST_DEBOUNCE_MS);
  };

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    runSearch();
  };

  const handleInputChange = (value: string) => {
    setQuery(value);
    triggerSuggest(value);
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
          <div className="flex flex-col gap-3 rounded-xl border border-neutral-800 bg-neutral-900/70 p-4">
            <Input
              value={query}
              onChange={(event) => handleInputChange(event.target.value)}
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
              <span className="text-xs text-neutral-500">Type at least 2 characters to search</span>
            </div>

            {suggestions.length > 0 && (
              <div className="flex flex-col gap-2 text-sm">
                {suggestions.map((item) => (
                  <button
                    key={`${item.id}-${item.name}`}
                    type="button"
                    onClick={() => handleInputChange(item.name)}
                    className="rounded-lg bg-neutral-950 px-3 py-2 text-left text-neutral-100 hover:bg-neutral-900"
                  >
                    <div className="font-medium text-neutral-50">{item.name}</div>
                    {item.subtitle && <div className="text-xs text-neutral-500">{item.subtitle}</div>}
                  </button>
                ))}
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
          <div className="text-sm text-neutral-500">Start typing to see results.</div>
        )}

        <YTMusicSearch sections={sections} />
      </div>
    </div>
  );
}
