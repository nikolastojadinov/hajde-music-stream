import { FormEvent, useEffect, useRef, useState } from "react";
import { MoreHorizontal, Search as SearchIcon } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { Input } from "@/components/ui/input";
import PlaylistListItem from "@/components/PlaylistListItem";
import SearchSuggestList from "@/components/search/SearchSuggestList";
import { adaptSearchPlaylistResult } from "@/lib/adapters/playlists";
import {
  searchResolve,
  searchSuggest,
  ingestSearchSelection,
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

/**
 * YT Music entity priority for HERO
 * (critical difference vs naive exact-match)
 */
const HERO_PRIORITY: (keyof SearchSections)[] = [
  "artists",
  "songs",
  "albums",
  "playlists",
];

const typeLabel: Record<keyof SearchSections, string> = {
  songs: "Song",
  artists: "Artist",
  albums: "Album",
  playlists: "Playlist",
};

const kindLabel: Record<SearchResultItem["kind"], string> = {
  song: "Song",
  artist: "Artist",
  album: "Album",
  playlist: "Playlist",
};

const heroLabel = (item: SearchResultItem): string => {
  if (item.endpointType === "watch" && normalize(item.subtitle).includes("video")) return "Video";
  return kindLabel[item.kind] || "Song";
};

const kindToContainer = (kind: SearchResultItem["kind"]): keyof SearchSections => {
  if (kind === "artist") return "artists";
  if (kind === "album") return "albums";
  if (kind === "playlist") return "playlists";
  return "songs";
};

type MixedResultItem = SearchResultItem & {
  container: keyof SearchSections;
};

/* ===========================
   Utils
=========================== */

const normalize = (v: unknown) =>
  typeof v === "string" ? v.trim().toLowerCase() : "";

const isVideoId = (id?: string | null) =>
  typeof id === "string" && /^[A-Za-z0-9_-]{11}$/.test(id);

const allowedKinds: SearchResultItem["kind"][] = ["song", "artist", "album", "playlist"];

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
  const [featured, setFeatured] = useState<SearchResultItem | null>(null);
  const [orderedItems, setOrderedItems] = useState<SearchResultItem[]>([]);
  const [suggestions, setSuggestions] = useState<SearchSuggestItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
      } catch {
        /* ignore */
      }
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
      setSections(res?.sections ?? { songs: [], artists: [], albums: [], playlists: [] });
      setOrderedItems(Array.isArray(res?.orderedItems) ? res.orderedItems : []);
      setFeatured(res?.featured ?? null);
    } catch {
      setError("Unable to load search results.");
      setOrderedItems([]);
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

  const orderedKinds: (keyof SearchSections)[] = ["songs", "artists", "albums", "playlists"];

  // Fallback to sections only if orderedItems missing (should rarely happen)
  const mixedResults: MixedResultItem[] = orderedKinds.flatMap((kind) =>
    Array.isArray(sections[kind])
      ? sections[kind].map((item) => ({ ...item, container: kind }))
      : []
  );

  const sourceList = (orderedItems.length > 0 ? orderedItems : mixedResults)
    .filter((item) => allowedKinds.includes(item.kind));

  const primaryList: MixedResultItem[] = sourceList.map((item) => ({
    ...item,
    container: kindToContainer(item.kind),
  }));

  /* ===========================
     HERO SELECTION (YT MUSIC)
     ✔ exact match
     ✔ entity priority
=========================== */

  const normalizedQuery = normalize(query);

  const heroItem: MixedResultItem | null = (() => {
    if (featured) {
      return { ...featured, container: kindToContainer(featured.kind) };
    }
    if (primaryList.length > 0) return primaryList[0];
    return null;
  })();

  const remainingResults = heroItem
    ? primaryList.filter(
        (item) =>
          !(
            item.container === heroItem.container &&
            item.id === heroItem.id
          )
      )
    : primaryList;

  /* ===========================
     Actions
  =========================== */

  const handleItemClick = (item: MixedResultItem) => {
    const enqueueIngest = (type: "song" | "video" | "album" | "playlist" | "artist") => {
      void ingestSearchSelection({
        type,
        id: item.endpointPayload,
        title: item.title,
        subtitle: item.subtitle,
        imageUrl: item.imageUrl,
      });
    };

    if (item.endpointType === "watch" && isVideoId(item.endpointPayload)) {
      const isVideo = normalize(item.subtitle).includes("video");
      enqueueIngest(isVideo ? "video" : "song");
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
      const browseId = (item.endpointPayload || "").trim();
      if (!browseId) return;

      if (item.container === "artists") {
        enqueueIngest("artist");
        navigate(`/artist/${encodeURIComponent(browseId)}`);
        return;
      }

      if (item.container === "albums") {
        enqueueIngest("album");
        navigate(`/playlist/${encodeURIComponent(browseId)}`, {
          state: {
            playlistId: browseId,
            playlistTitle: item.title,
            playlistCover: item.imageUrl ?? null,
          },
        });
        return;
      }

      // playlists
      enqueueIngest("playlist");
      navigate(`/playlist/${encodeURIComponent(browseId)}`, {
        state: {
          playlistId: browseId,
          playlistTitle: item.title,
          playlistCover: item.imageUrl ?? null,
        },
      });
    }
  };

  /* ===========================
     Render
  =========================== */

  return (
    <div className="min-h-screen bg-neutral-950 text-white">
      <div className="mx-auto max-w-xl px-3 pb-24 pt-3">

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
              placeholder="Search"
              className="h-11 rounded-full bg-neutral-900 pl-4 pr-10 text-sm"
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

        {/* HERO (Featured entity) */}
        {heroItem && (
          <div
            onClick={() => handleItemClick(heroItem)}
            className="mt-6 cursor-pointer rounded-3xl bg-gradient-to-r from-neutral-900 to-neutral-800 p-4 shadow-lg"
          >
            <div className="flex items-center gap-4">
              {heroItem.imageUrl ? (
                <img
                  src={heroItem.imageUrl}
                  className={`h-16 w-16 object-cover ${
                    heroItem.container === "artists"
                      ? "rounded-full"
                      : "rounded-xl"
                  }`}
                />
              ) : (
                <div
                  className={`h-16 w-16 bg-neutral-800 ${
                    heroItem.container === "artists" ? "rounded-full" : "rounded-xl"
                  }`}
                />
              )}
              <div className="flex-1">
                <div className="text-lg font-bold leading-tight">{heroItem.title}</div>
                <div className="text-sm text-neutral-400">{heroLabel(heroItem)}</div>
              </div>
            </div>
            <div className="mt-4 flex gap-3 text-sm">
              <button className="flex flex-1 items-center justify-center gap-2 rounded-full bg-white/10 px-3 py-2 text-white hover:bg-white/20">
                ▶ Play
              </button>
              <button className="flex flex-1 items-center justify-center gap-2 rounded-full bg-neutral-800 px-3 py-2 text-white hover:bg-neutral-700">
                🎧 Radio
              </button>
            </div>
          </div>
        )}

        {/* Results */}
        {submitted && (
          <div className="mt-6 flex flex-col gap-2">
            {remainingResults.map((item) => {
              if (item.container === "playlists") {
                const normalized = adaptSearchPlaylistResult({
                  id: item.id,
                  title: item.title,
                  subtitle: item.subtitle,
                  imageUrl: item.imageUrl,
                  endpointPayload: item.endpointPayload,
                });

                if (!normalized) return null;

                return (
                  <PlaylistListItem
                    key={`${item.container}-${item.id}`}
                    title={normalized.title}
                    subtitle={normalized.subtitle}
                    imageUrl={normalized.imageUrl ?? undefined}
                    badge={normalized.badge}
                    onSelect={() =>
                      navigate(`/playlist/${encodeURIComponent(normalized.browseId)}`, {
                        state: normalized.navState,
                      })
                    }
                  />
                );
              }

              const isArtist = item.container === "artists";
              const badge = item.endpointType === "watch" && normalize(item.subtitle).includes("video")
                ? "Video"
                : kindLabel[item.kind];

              return (
                <div
                  key={`${item.container}-${item.id}`}
                  onClick={() => handleItemClick(item)}
                  className="flex cursor-pointer items-center gap-3 rounded-2xl bg-neutral-900/70 px-3 py-3 hover:bg-neutral-800"
                >
                  {item.imageUrl ? (
                    <img
                      src={item.imageUrl}
                      className={`h-12 w-12 object-cover ${isArtist ? "rounded-full" : "rounded-xl"}`}
                    />
                  ) : (
                    <div
                      className={`h-12 w-12 bg-neutral-800 ${isArtist ? "rounded-full" : "rounded-xl"}`}
                    />
                  )}

                  <div className="flex-1 min-w-0">
                    <div className="truncate text-[15px] font-semibold leading-tight">
                      {item.title}
                    </div>
                    {item.subtitle && (
                      <div className="truncate text-xs text-neutral-400">
                        {item.subtitle}
                      </div>
                    )}
                  </div>

                  <span className="rounded-full border border-neutral-800 px-2 py-1 text-[10px] uppercase tracking-wide text-neutral-200">
                    {badge}
                  </span>

                  <MoreHorizontal className="h-5 w-5 text-neutral-500" />
                </div>
              );
            })}
          </div>
        )}

        {loading && (
          <div className="mt-4 text-sm text-neutral-400">
            Searching…
          </div>
        )}

        {!loading && submitted && remainingResults.length === 0 && !heroItem && (
          <div className="mt-4 text-sm text-neutral-500">
            No results found.
          </div>
        )}

        {error && (
          <div className="mt-4 text-sm text-red-400">
            {error}
          </div>
        )}
      </div>
    </div>
  );
}
