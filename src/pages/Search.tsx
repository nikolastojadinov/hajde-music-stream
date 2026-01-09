import { FormEvent, useEffect, useRef, useState } from "react";
import { MoreHorizontal, Search as SearchIcon } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { Input } from "@/components/ui/input";
import SearchSuggestList from "@/components/search/SearchSuggestList";
import {
  searchResolve,
  searchSuggest,
  type SearchResolveResponse,
  type SearchResultItem,
  type SearchSuggestItem,
  type SearchSections,
} from "@/lib/api/search";
import { usePlayer } from "@/contexts/PlayerContext";

/* ===========================
   Constants
=========================== */

const SUGGEST_DEBOUNCE_MS = 250;
const MAX_SUGGESTIONS = 15;

const typeLabel: Record<keyof SearchSections, string> = {
  songs: "Song",
  artists: "Artist",
  albums: "Album",
  playlists: "Playlist",
};

type MixedResultItem = SearchResultItem & {
  kind: keyof SearchSections;
};

/* ===========================
   Utils
=========================== */

const normalize = (v: unknown) =>
  typeof v === "string" ? v.trim().toLowerCase() : "";

const isVideoId = (id?: string | null) =>
  typeof id === "string" && /^[A-Za-z0-9_-]{11}$/.test(id);

/* ===========================
   Component
=========================== */

export default function Search() {
  const navigate = useNavigate();
  const { playTrack } = usePlayer();

  const [query, setQuery] = useState("");
  const [sections, setSections] = useState<SearchResolveResponse["sections"]>({
    songs: [],
    artists: [],
    albums: [],
    playlists: [],
  });
  const [suggestions, setSuggestions] = useState<SearchSuggestItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState(false);

  const suggestAbort = useRef<AbortController | null>(null);
  const suggestTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  /* ===========================
     Suggestions
  =========================== */

  const clearSuggestions = () => {
    suggestAbort.current?.abort();
    suggestAbort.current = null;
    setSuggestions([]);
  };

  const scheduleSuggest = (value: string) => {
    const q = value.trim();

    if (suggestTimer.current) clearTimeout(suggestTimer.current);

    if (q.length < 2) {
      clearSuggestions();
      return;
    }

    suggestTimer.current = setTimeout(async () => {
      suggestAbort.current?.abort();
      const controller = new AbortController();
      suggestAbort.current = controller;

      try {
        const res = await searchSuggest(q, { signal: controller.signal });
        setSuggestions(
          Array.isArray(res?.suggestions)
            ? res.suggestions.slice(0, MAX_SUGGESTIONS)
            : []
        );
      } catch {}
    }, SUGGEST_DEBOUNCE_MS);
  };

  /* ===========================
     Search
  =========================== */

  const runSearch = async (q: string) => {
    if (q.length < 2) return;

    setLoading(true);
    setError(null);

    try {
      const res = await searchResolve({ q });
      setSections(res?.sections ?? sections);
    } catch {
      setError("Unable to load search results.");
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    clearSuggestions();

    const q = query.trim();
    if (q.length < 2) return;

    setSubmitted(true);
    runSearch(q);
  };

  /* ===========================
     Build mixed list
     (ORIGINAL ORDER PRESERVED)
  =========================== */

  const orderedKinds: (keyof SearchSections)[] = [
    "songs",
    "artists",
    "albums",
    "playlists",
  ];

  const mixedResults: MixedResultItem[] = orderedKinds.flatMap((kind) =>
    Array.isArray(sections[kind])
      ? sections[kind].map((item) => ({ ...item, kind }))
      : []
  );

  /* ===========================
     FEATURED RESULT (YT Music)
     – first exact title match
  =========================== */

  const normalizedQuery = normalize(query);

  const featuredIndex = mixedResults.findIndex(
    (item) => normalize(item.title) === normalizedQuery
  );

  const featuredItem =
    featuredIndex >= 0 ? mixedResults[featuredIndex] : null;

  const remainingResults =
    featuredIndex >= 0
      ? mixedResults.filter((_, i) => i !== featuredIndex)
      : mixedResults;

  /* ===========================
     Render helpers
  =========================== */

  const handleItemClick = (item: MixedResultItem) => {
    if (item.endpointType === "watch" && isVideoId(item.endpointPayload)) {
      playTrack(
        {
          youtubeVideoId: item.endpointPayload,
          title: item.title,
          artist: item.subtitle || item.title,
          thumbnailUrl: item.imageUrl,
        },
        "song"
      );
      return;
    }

    if (item.endpointType === "browse") {
      if (item.kind === "artists") {
        navigate(`/artist/${encodeURIComponent(item.endpointPayload)}`);
      } else {
        navigate(`/playlist/${encodeURIComponent(item.endpointPayload)}`);
      }
    }
  };

  /* ===========================
     Render
  =========================== */

  return (
    <div className="min-h-screen bg-neutral-950 text-white">
      <div className="mx-auto max-w-5xl px-4 pb-24 pt-3">

        {/* Search bar */}
        <form
          onSubmit={handleSubmit}
          className="sticky top-0 z-40 bg-neutral-950/90 backdrop-blur"
        >
          <div className="relative">
            <Input
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                scheduleSuggest(e.target.value);
              }}
              placeholder="Search songs, artists, albums…"
              className="h-11 rounded-full bg-neutral-900 pl-4 pr-10"
            />
            <SearchIcon className="absolute right-4 top-1/2 h-5 w-5 -translate-y-1/2 text-neutral-500" />
          </div>

          {suggestions.length > 0 && (
            <SearchSuggestList
              suggestions={suggestions}
              onSelect={(item) => {
                clearSuggestions();
                if (item.type === "artist") {
                  navigate(`/artist/${item.id}`);
                }
              }}
            />
          )}
        </form>

        {/* Featured result */}
        {featuredItem && (
          <div
            onClick={() => handleItemClick(featuredItem)}
            className="mt-6 flex cursor-pointer items-center gap-4 rounded-2xl bg-neutral-900/60 p-4 hover:bg-neutral-900"
          >
            <img
              src={featuredItem.imageUrl}
              className="h-16 w-16 rounded-full object-cover"
            />
            <div>
              <div className="text-lg font-bold">
                {featuredItem.title}
              </div>
              <div className="text-sm text-neutral-400">
                {typeLabel[featuredItem.kind]}
              </div>
            </div>
          </div>
        )}

        {/* Results */}
        {submitted && (
          <div className="mt-6 flex flex-col gap-2">
            {remainingResults.map((item) => (
              <div
                key={`${item.kind}-${item.id}`}
                onClick={() => handleItemClick(item)}
                className="flex cursor-pointer items-center gap-3 rounded-lg px-2 py-2 hover:bg-neutral-900"
              >
                <img
                  src={item.imageUrl}
                  className="h-12 w-12 rounded-lg object-cover"
                />

                <div className="flex-1 min-w-0">
                  <div className="truncate font-semibold">
                    {item.title}
                  </div>
                  {item.subtitle && (
                    <div className="truncate text-xs text-neutral-400">
                      {item.subtitle}
                    </div>
                  )}
                </div>

                <span className="rounded-full bg-neutral-800 px-2 py-1 text-xs">
                  {typeLabel[item.kind]}
                </span>

                <MoreHorizontal className="h-5 w-5 text-neutral-400" />
              </div>
            ))}
          </div>
        )}

        {loading && (
          <div className="mt-4 text-sm text-neutral-400">
            Searching…
          </div>
        )}

        {!loading && submitted && remainingResults.length === 0 && !featuredItem && (
          <div className="mt-4 text-sm text-neutral-500">
            No results found.
          </div>
        )}
      </div>
    </div>
  );
}
