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

  const normalizeSuggestions = (response: unknown): SearchSuggestItem[] => {
    const res = response as any;
    const source = Array.isArray(res)
      ? res
      : Array.isArray(res?.items)
      ? res.items
      : Array.isArray(res?.results)
      ? res.results
      : Array.isArray(res?.suggestions)
      ? res.suggestions
      : [];

    const runText = (value: any) => {
      const runs = value?.runs;
      const run = Array.isArray(runs) ? runs[0] : undefined;
      return typeof run?.text === "string" ? run.text : undefined;
    };

    const flexText = (item: any, flexIndex: number) => {
      const runs = item?.flexColumns?.[flexIndex]?.musicResponsiveListItemFlexColumnRenderer?.text?.runs;
      const run = Array.isArray(runs) ? runs[0] : undefined;
      return typeof run?.text === "string" ? run.text : undefined;
    };

    return source
      .map((item: any, index: number) => {
        const type = typeof item?.type === "string" && ["artist", "track", "album", "playlist"].includes(item.type)
          ? (item.type as SearchSuggestItem["type"])
          : "track";

        const nameCandidate = [item?.name, item?.title, item?.text, runText(item?.text), item?.query, flexText(item, 0)].find(
          (value) => typeof value === "string" && value.trim().length > 0,
        );
        const name = typeof nameCandidate === "string" ? nameCandidate.trim() : "";
        if (!name) return null;

        const subtitleCandidate = typeof item?.subtitle === "string" && item.subtitle.trim().length > 0 ? item.subtitle : flexText(item, 1);
        const subtitle = typeof subtitleCandidate === "string" ? subtitleCandidate : undefined;

        const idCandidate = [item?.id, item?.videoId, item?.browseId].find(
          (value) => typeof value === "string" && value.trim().length > 0,
        );
        const id = (typeof idCandidate === "string" ? idCandidate : `${name}-${index}`).trim();

        const imageUrl = typeof item?.imageUrl === "string" && item.imageUrl.trim().length > 0 ? item.imageUrl : undefined;
        const artists = Array.isArray(item?.artists)
          ? item.artists.filter((artist: any) => typeof artist === "string" && artist.trim().length > 0)
          : undefined;

        return { type, id, name, subtitle, imageUrl, artists } satisfies SearchSuggestItem;
      })
      .filter(Boolean) as SearchSuggestItem[];
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
        setSuggestions(normalizeSuggestions(response));
      } catch (err: any) {
        if (err?.name === "AbortError") return;
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
          <div className="relative flex flex-col gap-3 rounded-xl border border-neutral-800 bg-neutral-900/70 p-4">
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
              <div className="absolute left-0 right-0 top-full z-50 mt-2 max-h-80 overflow-y-auto rounded-xl border border-neutral-800 bg-neutral-950/95 shadow-xl">
                <div className="flex flex-col divide-y divide-neutral-800 text-sm">
                  {suggestions.map((item) => (
                    <button
                      key={`${item.id}-${item.name}`}
                      type="button"
                      onClick={() => handleInputChange(item.name)}
                      className="flex flex-col gap-1 px-3 py-2 text-left text-neutral-100 hover:bg-neutral-900"
                    >
                      <div className="font-medium text-neutral-50">{item.name}</div>
                      {item.subtitle && <div className="text-xs text-neutral-500">{item.subtitle}</div>}
                    </button>
                  ))}
                </div>
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
