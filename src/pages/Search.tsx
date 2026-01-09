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

const SUGGEST_DEBOUNCE_MS = 250;
const MAX_SUGGESTIONS = 15;

const typeLabel: Record<keyof SearchSections, string> = {
  songs: "Song",
  artists: "Artist",
  albums: "Album",
  playlists: "Playlist",
};

const allowedSuggestionTypes: SearchSuggestItem["type"][] = ["artist", "track", "album", "playlist"];

type MixedResultItem = SearchResultItem & { kind: keyof SearchSections };

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
  const [hasSubmitted, setHasSubmitted] = useState(false);

  const suggestAbortRef = useRef<AbortController | null>(null);
  const suggestTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearSuggestions = () => {
    suggestAbortRef.current?.abort();
    suggestAbortRef.current = null;
    setSuggestions([]);
  };

  const resetResults = () => {
    setSections({ songs: [], artists: [], albums: [], playlists: [] });
    setError(null);
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
      resetResults();
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
    const trimmed = normalizeString(query);
    if (trimmed.length < 2) {
      setHasSubmitted(false);
      resetResults();
      return;
    }

    setHasSubmitted(true);
    void runSearch(trimmed);
  };

  const handleInputChange = (value: string) => {
    setQuery(value);
    scheduleSuggest(value);

    if (normalizeString(value).length === 0) {
      setHasSubmitted(false);
      resetResults();
    }
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

  const handleResultClick = (sectionKind: MixedResultItem["kind"], item: MixedResultItem) => {
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

  useEffect(() => {
    document.body.classList.add("search-page", "search-expanded");
    return () => {
      document.body.classList.remove("search-page", "search-expanded");
    };
  }, []);

  const orderedSections: (keyof SearchSections)[] = ["songs", "artists", "albums", "playlists"];
  const mixedResults: MixedResultItem[] = orderedSections.flatMap((kind) =>
    Array.isArray(sections?.[kind])
      ? sections[kind].map((item) => ({ ...item, kind }))
      : []
  );
  const hasResults = mixedResults.length > 0;
  const readyForResults = hasSubmitted && normalizeString(query).length >= 2;

  return (
    <div className="min-h-screen bg-neutral-950 text-white">
      <div className="mx-auto flex min-h-screen max-w-5xl flex-col px-4 pb-24 pt-4 md:px-6">
        <form onSubmit={handleSubmit} className="sticky top-0 z-40 -mx-1 mb-5 bg-neutral-950/95 px-1 pt-1 backdrop-blur-md">
          <div className="relative flex items-center rounded-full border border-neutral-800/80 bg-neutral-900/90 px-4 py-3 shadow-[0_18px_40px_rgba(0,0,0,0.35)] ring-1 ring-black/40">
            <Input
              value={query}
              onChange={(e) => handleInputChange(e.target.value)}
              placeholder="Traži pesme, izvođače, albume..."
              className="h-11 flex-1 border-none bg-transparent text-base text-white placeholder:text-neutral-500 focus-visible:ring-0 focus-visible:ring-offset-0"
            />
            <SearchIcon className="ml-3 h-5 w-5 flex-shrink-0 text-neutral-500" />
          </div>
          {suggestions.length > 0 && (
            <div className="relative">
              <div className="absolute left-0 right-0 top-2 z-40 max-h-[60vh] overflow-y-auto rounded-2xl border border-neutral-800 bg-neutral-950/95 shadow-2xl">
                <SearchSuggestList suggestions={suggestions} onSelect={handleSelect} />
              </div>
            </div>
          )}
        </form>

        {error && (
          <div className="mb-4 rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-100">
            {error}
          </div>
        )}

        {!readyForResults && !loading && !error && (
          <div className="mt-6 text-sm text-neutral-500">Upiši makar 2 karaktera i pokreni pretragu.</div>
        )}

        {readyForResults && !hasResults && !loading && !error && (
          <div className="mt-6 text-sm text-neutral-500">Nema pronađenih rezultata za ovaj upit.</div>
        )}

        {loading && (
          <div className="mt-6 text-sm text-neutral-400">Pretražujemo...</div>
        )}

        <div className="flex flex-1 flex-col gap-3 pb-10">
          {mixedResults.map((item) => (
            <div
              key={`${item.kind}-${item.id}`}
              role="button"
              tabIndex={0}
              onClick={() => handleResultClick(item.kind, item)}
              onKeyDown={(evt) => {
                if (evt.key === "Enter" || evt.key === " ") {
                  evt.preventDefault();
                  handleResultClick(item.kind, item);
                }
              }}
              className="group flex items-center gap-4 rounded-2xl border border-white/5 bg-neutral-900/80 px-3 py-2 shadow-[0_14px_30px_rgba(0,0,0,0.35)] transition hover:-translate-y-0.5 hover:border-white/10 hover:bg-neutral-900"
            >
              <div className="relative h-16 w-16 overflow-hidden rounded-xl border border-white/5 bg-neutral-800">
                {item.imageUrl ? (
                  <img src={item.imageUrl} alt={item.title} className="h-full w-full object-cover" />
                ) : (
                  <div className="flex h-full w-full items-center justify-center text-lg font-semibold text-neutral-300">
                    {item.title.slice(0, 2)}
                  </div>
                )}
              </div>

              <div className="flex min-w-0 flex-1 flex-col gap-1">
                <div className="flex items-center gap-2">
                  <span className="truncate text-sm font-semibold text-neutral-50">{item.title}</span>
                  <span className="rounded-full border border-white/10 px-2 py-0.5 text-[11px] uppercase tracking-wide text-neutral-400">
                    {typeLabel[item.kind]}
                  </span>
                </div>
                {item.subtitle ? <p className="truncate text-xs text-neutral-400">{item.subtitle}</p> : null}
              </div>

              <button
                type="button"
                onClick={(evt) => evt.stopPropagation()}
                className="flex h-10 w-10 items-center justify-center rounded-full border border-white/5 bg-neutral-900/80 text-neutral-300 opacity-80 transition hover:border-white/15 hover:bg-neutral-800 hover:text-white"
                aria-label="More actions"
              >
                <MoreHorizontal className="h-5 w-5" />
              </button>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
