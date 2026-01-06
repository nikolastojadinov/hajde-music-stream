import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { searchResolve, searchSuggest, type SearchResolveResponse, type SearchSection, type SearchSuggestItem } from "@/lib/api/search";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

const SUGGEST_DEBOUNCE_MS = 250;

function matchesSection(section: SearchSection, keywords: string[]): boolean {
  const label = `${section.kind ?? ""} ${section.title ?? ""}`.toLowerCase();
  return keywords.some((keyword) => label.includes(keyword));
}

function pickTitle(item: any, fallbackLabel: string): string {
  const rawTitle =
    item?.title ||
    item?.name ||
    item?.text ||
    item?.headline ||
    item?.label ||
    item?.subtitle;

  const title = typeof rawTitle === "string" ? rawTitle : "";
  return title.trim() || fallbackLabel;
}

function pickSubtitle(item: any, fallbackLabel: string): string {
  if (Array.isArray(item?.artists) && item.artists.length > 0) {
    return item.artists.filter(Boolean).join(", ");
  }

  const subtitle =
    item?.artist ||
    item?.subtitle ||
    item?.channelTitle ||
    item?.channel ||
    item?.owner ||
    item?.album;

  const cleaned = typeof subtitle === "string" ? subtitle.trim() : "";
  return cleaned || fallbackLabel;
}

function pickImage(item: any): string | null {
  if (typeof item?.imageUrl === "string") return item.imageUrl;
  if (typeof item?.thumbnail === "string") return item.thumbnail;
  if (typeof item?.thumbnailUrl === "string") return item.thumbnailUrl;

  if (Array.isArray(item?.thumbnails) && item.thumbnails.length > 0) {
    const candidate = item.thumbnails.find((thumb: any) => typeof thumb?.url === "string");
    if (candidate?.url) return candidate.url as string;
  }

  return null;
}

function getInitials(text: string): string {
  const trimmed = text.trim();
  if (!trimmed) return "";

  const words = trimmed.split(/\s+/).slice(0, 2);
  return words
    .map((word) => word[0])
    .join("")
    .toUpperCase();
}

type SearchCardProps = {
  item: any;
  fallbackTitle: string;
};

function SearchCard({ item, fallbackTitle }: SearchCardProps) {
  const title = pickTitle(item, fallbackTitle);
  const subtitle = pickSubtitle(item, "");
  const image = pickImage(item);
  const initials = getInitials(title);

  return (
    <div className="w-44 shrink-0 snap-start rounded-xl border border-neutral-800 bg-neutral-900/70 p-3 transition duration-200 hover:-translate-y-1 hover:border-neutral-600 hover:bg-neutral-900">
      <div className="aspect-square w-full overflow-hidden rounded-lg bg-gradient-to-br from-neutral-800 to-neutral-900">
        {image ? (
          <img
            src={image}
            alt={title}
            className="h-full w-full object-cover"
            loading="lazy"
          />
        ) : (
          <div className="flex h-full items-center justify-center text-lg font-semibold text-neutral-300">
            {initials || "♪"}
          </div>
        )}
      </div>

      <div className="mt-3 space-y-1">
        <p className="text-sm font-semibold text-white">
          <span className="block overflow-hidden text-ellipsis whitespace-nowrap">{title}</span>
        </p>
        {subtitle && (
          <p className="text-xs text-neutral-400">
            <span className="block overflow-hidden text-ellipsis whitespace-nowrap">{subtitle}</span>
          </p>
        )}
      </div>
    </div>
  );
}

type SearchSectionShelfProps = {
  title: string;
  items: any[];
};

function SearchSectionShelf({ title, items }: SearchSectionShelfProps) {
  if (!items || items.length === 0) return null;

  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between pr-1">
        <h3 className="text-base font-semibold text-white">{title}</h3>
        <div className="h-px flex-1 translate-y-1 bg-gradient-to-r from-neutral-700/70 to-transparent" />
      </div>

      <div className="-mx-4 flex gap-3 overflow-x-auto px-4 pb-2 snap-x snap-mandatory">
        {items.map((item, index) => {
          const key = item?.id ?? `${title}-${index}`;
          return <SearchCard key={key} item={item} fallbackTitle={title} />;
        })}
      </div>
    </section>
  );
}

type SectionConfig = {
  title: string;
  keywords: string[];
};

const SECTION_CONFIGS: SectionConfig[] = [
  { title: "Songs", keywords: ["song", "track", "songs"] },
  { title: "Artists", keywords: ["artist", "artists"] },
  { title: "Albums", keywords: ["album", "albums"] },
  { title: "Playlists", keywords: ["playlist", "playlists"] },
];

export default function YTMusicSearch() {
  const [query, setQuery] = useState("");
  const [suggestions, setSuggestions] = useState<SearchSuggestItem[]>([]);
  const [results, setResults] = useState<SearchResolveResponse | null>(null);
  const [loadingResults, setLoadingResults] = useState(false);
  const [loadingSuggest, setLoadingSuggest] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const suggestAbortRef = useRef<AbortController | null>(null);
  const searchAbortRef = useRef<AbortController | null>(null);

  // Debounced suggest
  useEffect(() => {
    const trimmed = query.trim();

    if (trimmed.length < 2) {
      suggestAbortRef.current?.abort();
      setSuggestions([]);
      return;
    }

    setLoadingSuggest(true);
    const controller = new AbortController();
    suggestAbortRef.current?.abort();
    suggestAbortRef.current = controller;

    const handle = window.setTimeout(async () => {
      try {
        const response = await searchSuggest(trimmed, { signal: controller.signal });
        if (!controller.signal.aborted) {
          setSuggestions(response?.suggestions ?? []);
        }
      } catch (error) {
        if (!controller.signal.aborted) {
          console.error("Search suggest failed", error);
          setSuggestions([]);
        }
      } finally {
        if (!controller.signal.aborted) {
          setLoadingSuggest(false);
        }
      }
    }, SUGGEST_DEBOUNCE_MS);

    return () => {
      controller.abort();
      window.clearTimeout(handle);
      setLoadingSuggest(false);
    };
  }, [query]);

  const runSearch = async (text?: string) => {
    const nextQuery = (text ?? query).trim();
    if (nextQuery.length < 2) return;

    searchAbortRef.current?.abort();
    const controller = new AbortController();
    searchAbortRef.current = controller;

    setLoadingResults(true);
    setErrorMessage(null);

    try {
      const response = await searchResolve({ q: nextQuery }, { signal: controller.signal });
      if (!controller.signal.aborted) {
        setResults(response);
      }
    } catch (error) {
      if (!controller.signal.aborted) {
        console.error("Search resolve failed", error);
        setErrorMessage("We could not load results right now.");
      }
    } finally {
      if (!controller.signal.aborted) {
        setLoadingResults(false);
      }
    }
  };

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    runSearch();
  };

  const sectionedResults = useMemo(() => {
    const availableSections = results?.sections ?? [];
    return SECTION_CONFIGS.map((config) => ({
      title: config.title,
      items: availableSections
        .filter((section) => matchesSection(section, config.keywords))
        .flatMap((section) => section.items ?? []),
    })).filter((section) => section.items.length > 0);
  }, [results]);

  const hasResults = sectionedResults.some((section) => section.items.length > 0);
  const showEmptyState = results && !loadingResults && !hasResults;

  return (
    <div className="min-h-[calc(100vh-4rem)] bg-neutral-950 text-white">
      <div className="mx-auto max-w-6xl px-4 pb-16 pt-6 space-y-8">
        <form onSubmit={handleSubmit} className="space-y-3">
          <div className="flex flex-col gap-3 rounded-2xl border border-neutral-800/80 bg-neutral-900/70 p-4 shadow-xl shadow-black/30">
            <div className="flex flex-col gap-3 md:flex-row md:items-center">
              <div className="relative flex-1">
                <Input
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="Search music, artists, albums..."
                  className="w-full border-neutral-700 bg-neutral-950/70 text-white placeholder:text-neutral-500 focus-visible:ring-neutral-500"
                />

                {suggestions.length > 0 && (
                  <div className="absolute left-0 right-0 top-[calc(100%+0.5rem)] z-20 overflow-hidden rounded-xl border border-neutral-800 bg-neutral-900/95 shadow-2xl shadow-black/40">
                    {suggestions.map((suggestion) => {
                      const label = pickTitle(suggestion, "Suggestion");
                      const meta = pickSubtitle(suggestion, "");

                      return (
                        <button
                          key={suggestion.id}
                          type="button"
                          className="flex w-full items-center gap-3 px-4 py-3 text-left transition hover:bg-neutral-800/80"
                          onClick={() => {
                            setQuery(label);
                            runSearch(label);
                          }}
                        >
                          <div className="h-10 w-10 overflow-hidden rounded-lg bg-neutral-800">
                            {suggestion.imageUrl ? (
                              <img
                                src={suggestion.imageUrl}
                                alt={label}
                                className="h-full w-full object-cover"
                                loading="lazy"
                              />
                            ) : (
                              <div className="flex h-full items-center justify-center text-xs font-semibold text-neutral-300">
                                {getInitials(label) || "♪"}
                              </div>
                            )}
                          </div>
                          <div className="flex-1">
                            <p className="text-sm font-semibold text-white">{label}</p>
                            {meta && <p className="text-xs text-neutral-400">{meta}</p>}
                          </div>
                          <span className="text-[11px] uppercase tracking-wide text-neutral-500">
                            {suggestion.type}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>

              <Button
                type="submit"
                variant="secondary"
                className="min-w-[120px] bg-neutral-100 text-neutral-900 hover:bg-white"
                disabled={loadingResults}
              >
                {loadingResults ? "Searching..." : "Search"}
              </Button>
            </div>

            <div className="flex items-center justify-between text-xs text-neutral-500">
              <span>
                {loadingSuggest
                  ? "Fetching suggestions..."
                  : suggestions.length > 0
                    ? "Tap a suggestion or press Enter"
                    : "Start typing to search"}
              </span>
              {results?.refinements && results.refinements.length > 0 && (
                <div className="flex flex-wrap items-center gap-2">
                  {results.refinements.map((refinement) => (
                    <button
                      key={refinement}
                      type="button"
                      className="rounded-full border border-neutral-700 px-3 py-1 text-xs text-neutral-200 transition hover:border-neutral-500 hover:text-white"
                      onClick={() => {
                        setQuery(refinement);
                        runSearch(refinement);
                      }}
                    >
                      {refinement}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        </form>

        {errorMessage && (
          <div className="rounded-xl border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm text-red-100">
            {errorMessage}
          </div>
        )}

        {loadingResults && (
          <div className="text-sm text-neutral-400">Loading results...</div>
        )}

        {showEmptyState && (
          <div className="rounded-xl border border-neutral-800 bg-neutral-900/60 px-4 py-6 text-center text-sm text-neutral-400">
            No matches yet. Try a different search term.
          </div>
        )}

        <div className="space-y-10">
          {sectionedResults.map((section) => (
            <SearchSectionShelf key={section.title} title={section.title} items={section.items} />
          ))}
        </div>
      </div>
    </div>
  );
}
