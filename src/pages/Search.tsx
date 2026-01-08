import { FormEvent, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import SearchSuggestList from "@/components/search/SearchSuggestList";
import {
  searchResolve,
  searchSuggest,
  type SearchResolveResponse,
  type SearchSuggestItem,
  type SearchSections,
} from "@/lib/api/search";
import { usePlayer } from "@/contexts/PlayerContext";

const SUGGEST_DEBOUNCE_MS = 250;
const MAX_SUGGESTIONS = 15;

const typeLabel: Record<keyof SearchSections, string> = { songs: "Songs", artists: "Artists", albums: "Albums", playlists: "Playlists" };

const allowedSuggestionTypes: SearchSuggestItem["type"][] = ["artist", "track", "album", "playlist"];

const isVideoId = (id: string | undefined | null): boolean => typeof id === "string" && /^[A-Za-z0-9_-]{11}$/.test(id.trim());

const normalizeString = (value: unknown): string => (typeof value === "string" ? value.trim() : "");

const normalizeSuggestions = (value: unknown): SearchSuggestItem[] => {
  if (!Array.isArray(value)) return [];

  const out: SearchSuggestItem[] = [];

  for (const raw of value) {
    const type = (raw as any)?.type;
    const id = normalizeString((raw as any)?.id);
    const name = normalizeString((raw as any)?.name);
    if (!allowedSuggestionTypes.includes(type) || !id || !name) continue;

    const imageUrl = normalizeString((raw as any)?.imageUrl) || undefined;
    const subtitle = normalizeString((raw as any)?.subtitle) || undefined;

    out.push({ type, id, name, imageUrl, subtitle });
    if (out.length >= MAX_SUGGESTIONS) break;
  }

  return out;
};

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

  const suggestAbortRef = useRef<AbortController | null>(null);
  const suggestTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearSuggestions = () => {
    suggestAbortRef.current?.abort();
    suggestAbortRef.current = null;
    setSuggestions([]);
  };

  const playVideo = (videoId: string, title: string, artist?: string, imageUrl?: string) => {
    if (!isVideoId(videoId)) return;
    playTrack({ youtubeVideoId: videoId, title, artist: artist || title, thumbnailUrl: imageUrl || undefined }, "song");
  };

  const normalizeSections = (value: unknown): SearchSections => {
    const songs = Array.isArray((value as any)?.songs) ? (value as any).songs : [];
    const artists = Array.isArray((value as any)?.artists) ? (value as any).artists : [];
    const albums = Array.isArray((value as any)?.albums) ? (value as any).albums : [];
    const playlists = Array.isArray((value as any)?.playlists) ? (value as any).playlists : [];
    return { songs, artists, albums, playlists };
  };

  const runSearch = async (value?: string) => {
    const nextQuery = normalizeString(value ?? query);
    if (nextQuery.length < 2) {
      setSections({ songs: [], artists: [], albums: [], playlists: [] });
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const response = await searchResolve({ q: nextQuery });
      const nextSections = normalizeSections(response?.sections);
      setSections(nextSections);
    } catch {
      setError("Unable to load search results.");
      setSections({ songs: [], artists: [], albums: [], playlists: [] });
    } finally {
      setLoading(false);
    }
  };

  const scheduleSuggest = (value: string) => {
    const trimmed = normalizeString(value);

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
        setSuggestions(normalizeSuggestions(res?.suggestions));
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

    if (item.type === "album" || item.type === "playlist") {
      navigate(`/playlist/${encodeURIComponent(item.id)}`);
      return;
    }

    if (item.type === "track" && isVideoId(item.id)) {
      playVideo(item.id, item.name, item.subtitle, item.imageUrl);
    }
  };

  const handleResultClick = (
    sectionKind: SearchResolveResponse["sections"][number]["kind"],
    item: SearchResolveResponse["sections"][number]["items"][number]
  ) => {
    if (item.endpointType === "watch" && isVideoId(item.endpointPayload)) {
      playVideo(item.endpointPayload, item.title, item.subtitle, item.imageUrl);
      return;
    }

    if (item.endpointType === "browse") {
      if (sectionKind === "artists") {
        navigate(`/artist/${encodeURIComponent(item.endpointPayload)}`);
        return;
      }

      if (sectionKind === "albums" || sectionKind === "playlists") {
        navigate(`/playlist/${encodeURIComponent(item.endpointPayload)}`);
      }
    }
  };

  useEffect(() => {
    return () => {
      if (suggestTimeoutRef.current) {
        clearTimeout(suggestTimeoutRef.current);
      }
      clearSuggestions();
    };
  }, []);

  const orderedSections: (keyof SearchSections)[] = ["songs", "artists", "albums", "playlists"];

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
              <Button type="submit" className="bg-neutral-100 text-neutral-900 hover:bg-white" disabled={loading}>
                {loading ? "Searching..." : "Search"}
              </Button>
              <span className="text-xs text-neutral-500">Type at least 2 characters to search</span>
            </div>

            {suggestions.length > 0 && (
              <div className="absolute left-0 right-0 top-full z-50 mt-2 max-h-[70vh] overflow-y-auto rounded-xl border border-neutral-800 bg-neutral-950/95 shadow-xl">
                <SearchSuggestList suggestions={suggestions} onSelect={handleSelect} />
              </div>
            )}
          </div>
        </form>

        {error && <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-100">{error}</div>}

        {!loading && sections.length === 0 && !error && <div className="text-sm text-neutral-500">Start typing to see results.</div>}

        <div className="space-y-8">
          {orderedSections.map((kind) => {
            const items = Array.isArray(sections?.[kind]) ? sections[kind] : [];
            if (items.length === 0) return null;
            return (
              <div key={kind} className="space-y-3">
                <h2 className="text-xl font-semibold text-neutral-100">{typeLabel[kind]}</h2>
                <div className="flex gap-4 overflow-x-auto pb-2">
                  {items.map((item) => (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => handleResultClick(kind, item)}
                      className="w-44 shrink-0 text-left"
                    >
                      <div className="h-44 w-full overflow-hidden rounded-xl border border-white/5 bg-neutral-900">
                        {item.imageUrl ? (
                          <img src={item.imageUrl} alt={item.title} className="h-full w-full object-cover" />
                        ) : (
                          <div className="flex h-full items-center justify-center text-lg font-semibold text-neutral-400">{item.title.slice(0, 2)}</div>
                        )}
                      </div>
                      <div className="mt-2 space-y-1">
                        <div className="truncate text-sm font-semibold text-neutral-50">{item.title}</div>
                        {item.subtitle ? <div className="truncate text-xs text-neutral-400">{item.subtitle}</div> : null}
                      </div>
                    </button>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
