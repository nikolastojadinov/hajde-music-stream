import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { Disc3, History, ListMusic, Music, Search as SearchIcon, User, X } from "lucide-react";
import debounce from "lodash.debounce";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import EmptyState from "@/components/ui/EmptyState";
import ErrorState from "@/components/ui/ErrorState";
import LoadingSkeleton from "@/components/ui/LoadingSkeleton";
import { usePi } from "@/contexts/PiContext";
import { usePlayer } from "@/contexts/PlayerContext";
import {
  searchResolve,
  searchSuggest,
  type SearchResolveMode,
  type SearchResolveResponse,
  type SearchSuggestResponse,
  deleteRecentSearch,
  getRecentSearches,
  upsertRecentSearch,
  type RecentSearchItem,
} from "@/lib/api/search";
import { fetchArtistByKey, prefetchArtistByKey } from "@/lib/api/artist";
import { deriveArtistKey } from "@/lib/artistKey";

type Suggestion = {
  type: "artist" | "track" | "playlist" | "album";
  id: string;
  name: string;
  imageUrl?: string;
  subtitle?: string;
  artists?: string[];
};

type SongResult = {
  key: string;
  title: string;
  artist: string;
  youtubeId: string;
  trackId: string;
};

function recentEntityLabel(type: RecentSearchItem["entity_type"]): string {
  switch (type) {
    case "artist":
      return "Artist";
    case "song":
      return "Song";
    case "playlist":
      return "Playlist";
    case "album":
      return "Album";
    default:
      return "Search";
  }
}

function suggestionTypeLabel(type: Suggestion["type"]): string {
  switch (type) {
    case "artist":
      return "Artist";
    case "track":
      return "Song";
    case "album":
      return "Album";
    case "playlist":
      return "Playlist";
    default:
      return "";
  }
}

function normalizeQuery(value: string): string {
  return value.trim();
}

function firstLetter(title: string): string {
  const trimmed = title.trim();
  if (!trimmed) return "?";
  return trimmed[0]?.toUpperCase() ?? "?";
}

function getResolvedArtistName(resolved: SearchResolveResponse | null): string | null {
  const artistFromTable = resolved?.artist?.name?.trim();
  if (artistFromTable) return artistFromTable;

  const artistFromResolve = resolved?.artist_name?.trim();
  return artistFromResolve || null;
}

function parseArtistAndTitle(rawTitle: string): { artistFromTitle: string | null; titleWithoutArtist: string } {
  const safeTitle = rawTitle ?? "";
  const parts = safeTitle.split(" - ");

  if (parts.length >= 2) {
    const potentialArtist = (parts.shift() ?? "").trim();
    const remainder = parts.join(" - ").trim();

    if (potentialArtist && remainder) {
      return { artistFromTitle: potentialArtist, titleWithoutArtist: remainder };
    }
  }

  const cleaned = safeTitle.trim();
  return { artistFromTitle: null, titleWithoutArtist: cleaned || safeTitle };
}

function deriveDisplayArtist(resolvedArtistName: string | null, artistFromTitle: string | null): string {
  if (resolvedArtistName) return resolvedArtistName;
  if (artistFromTitle) return artistFromTitle;
  return "Unknown artist";
}

export default function Search() {
  const { playTrack } = usePlayer();
  const { user } = usePi();
  const navigate = useNavigate();
  const location = useLocation();

  const [query, setQuery] = useState("");
  const [suggestions, setSuggestions] = useState<SearchSuggestResponse | null>(null);
  const [suggestLoading, setSuggestLoading] = useState(false);
  const [suggestOpen, setSuggestOpen] = useState(false);

  const [resolved, setResolved] = useState<SearchResolveResponse | null>(null);
  const [resolveLoading, setResolveLoading] = useState(false);

  const [recentSearches, setRecentSearches] = useState<RecentSearchItem[]>([]);
  const [recentLoading, setRecentLoading] = useState(false);
  const [recentError, setRecentError] = useState<string | null>(null);
  const [recentArtistThumbs, setRecentArtistThumbs] = useState<Record<string, string | null>>({});

  const [relatedArtists, setRelatedArtists] = useState<string[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const suggestAbortRef = useRef<AbortController | null>(null);
  const resolveAbortRef = useRef<AbortController | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const lastPrefetchedArtistsRef = useRef<string>("");
  const tickingRef = useRef(false);
  const userId = user?.uid ?? null;

  const normalizedQuery = useMemo(() => normalizeQuery(query), [query]);
  const normalizedLength = normalizedQuery.length;
  const filteredRecentSearches = useMemo(() => {
    if (!recentSearches || recentSearches.length === 0) return [] as RecentSearchItem[];
    if (!normalizedQuery) return recentSearches;
    const q = normalizedQuery.toLowerCase();
    return recentSearches.filter((item) => item.query.toLowerCase().includes(q));
  }, [normalizedQuery, recentSearches]);

  const showRecentsDropdown = suggestOpen && filteredRecentSearches.length > 0;
  const showSuggestDropdown = suggestOpen;
  const showDropdown = showRecentsDropdown || showSuggestDropdown;
  const showRecent = Boolean(userId) && normalizedLength === 0;

  const refreshRecentSearches = useCallback(async () => {
    if (!userId) {
      setRecentSearches([]);
      setRecentLoading(false);
      setRecentError(null);
      return;
    }

    setRecentLoading(true);
    setRecentError(null);

    try {
      const items = await getRecentSearches();
      setRecentSearches(items);
    } catch (e: any) {
      setRecentError(e?.message || "Failed to load recent searches");
    } finally {
      setRecentLoading(false);
    }
  }, [userId]);

  const persistRecentSearch = useCallback(
    async (payload: { query: string; entity_type?: RecentSearchItem["entity_type"]; entity_id?: string | null }) => {
      const normalized = normalizeQuery(payload.query);
      if (!userId || !normalized) return;

      try {
        const items = await upsertRecentSearch({
          query: normalized,
          entity_type: payload.entity_type ?? "generic",
          entity_id: payload.entity_id ?? null,
        });
        setRecentSearches(items);
        setRecentError(null);
      } catch (e) {
        console.warn("[recent_search] save_failed", e);
        setRecentError("Unable to save recent search");
      }
    },
    [userId],
  );

  const handleDeleteRecent = useCallback(
    async (id: number) => {
      if (!userId) return;

      setRecentSearches((prev) => prev.filter((item) => item.id !== id));

      try {
        const items = await deleteRecentSearch(id);
        setRecentSearches(items);
        setRecentError(null);
      } catch (e: any) {
        setRecentError(e?.message || "Failed to delete recent search");
        void refreshRecentSearches();
      }
    },
    [refreshRecentSearches, userId],
  );

  const clearQuery = () => {
    suggestAbortRef.current?.abort();
    resolveAbortRef.current?.abort();

    setQuery("");
    setSuggestOpen(false);
    setSuggestions(null);
    setSuggestLoading(false);

    setResolved(null);
    setResolveLoading(false);
    setRelatedArtists(null);
    setError(null);

    requestAnimationFrame(() => {
      inputRef.current?.focus();
    });
  };

  const debouncedSearchSuggest = useMemo(
    () =>
      debounce((q: string) => {
        suggestAbortRef.current?.abort();
        const controller = new AbortController();
        suggestAbortRef.current = controller;

        setSuggestLoading(true);
        setError(null);

        void (async () => {
          try {
            const next = await searchSuggest(q, { signal: controller.signal });
            if (!controller.signal.aborted) setSuggestions(next);
          } catch (e: any) {
            if (controller.signal.aborted) return;
            setSuggestions(null);
            setError(e?.message || "Search suggest failed");
          } finally {
            if (!controller.signal.aborted) setSuggestLoading(false);
          }
        })();
      }, 300),
    [],
  );

  useEffect(() => {
    return () => {
      debouncedSearchSuggest.cancel();
      suggestAbortRef.current?.abort();
    };
  }, [debouncedSearchSuggest]);

  useEffect(() => {
    void refreshRecentSearches();
  }, [refreshRecentSearches]);

  useEffect(() => {
    if (normalizedLength < 2) {
      debouncedSearchSuggest.cancel();
      suggestAbortRef.current?.abort();
      setSuggestions(null);
      setSuggestLoading(false);
      return;
    }

    debouncedSearchSuggest(normalizedQuery);
  }, [normalizedLength, normalizedQuery, debouncedSearchSuggest]);

  const flatSuggestions: Suggestion[] = useMemo(() => {
    if (!suggestions) return [];

    const maxItems = 12;
    return (Array.isArray(suggestions.suggestions) ? suggestions.suggestions : [])
      .filter((s) => Boolean(s && typeof s === "object"))
      .map((s) => s as Suggestion)
      .filter((s) => Boolean(s.id && s.name && s.name.trim() && s.type))
      .slice(0, maxItems);
  }, [suggestions]);

  const suggestIsFallback = suggestions?.source === "local_fallback";

  const recentArtistsForShelf = useMemo(
    () => filteredRecentSearches.filter((r) => r.entity_type === "artist").slice(0, 10),
    [filteredRecentSearches]
  );

  const recentPlaylistsForShelf = useMemo(
    () => filteredRecentSearches.filter((r) => r.entity_type === "playlist").slice(0, 20),
    [filteredRecentSearches]
  );

  useEffect(() => {
    // Prefetch artist thumbs for shelf (best-effort)
    const uniqueKeys = new Map<string, string>();
    for (const item of recentArtistsForShelf) {
      const key = deriveArtistKey(item.query);
      if (key) uniqueKeys.set(item.query, key);
    }
    if (uniqueKeys.size === 0) return;

    const already = new Set(Object.keys(recentArtistThumbs));
    const toFetch = Array.from(uniqueKeys.entries()).filter(([query]) => !already.has(query));
    if (toFetch.length === 0) return;

    let cancelled = false;
    (async () => {
      const updates: Record<string, string | null> = {};
      for (const [query, key] of toFetch) {
        try {
          const res = await fetchArtistByKey(key).catch(() => null);
          const thumb = res?.artist?.thumbnail_url ?? res?.artist?.banner_url ?? null;
          updates[query] = typeof thumb === "string" && thumb.trim() ? thumb.trim() : null;
        } catch {
          updates[query] = null;
        }
      }
      if (!cancelled && Object.keys(updates).length > 0) {
        setRecentArtistThumbs((prev) => ({ ...prev, ...updates }));
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [recentArtistsForShelf, recentArtistThumbs]);

  const resolvedArtistName = useMemo(() => getResolvedArtistName(resolved), [resolved]);

  const resolvedArtistThumb = useMemo(() => {
    const url = resolved?.artist?.thumbnail_url;
    return typeof url === "string" && url.trim() ? url.trim() : null;
  }, [resolved]);

  const resultsSongs = useMemo(() => {
    const trackCandidates: any[] = Array.isArray((resolved as any)?.tracks)
      ? ((resolved as any).tracks as any[])
      : Array.isArray(resolved?.local?.tracks)
        ? (resolved?.local?.tracks as any[])
        : [];

    return trackCandidates
      .map((t) => {
        const youtubeId = typeof t?.externalId === "string" ? t.externalId.trim() : "";
        if (!youtubeId) return null;

        const trackId = typeof t?.id === "string" ? t.id : youtubeId;
        const rawTitle = typeof t?.title === "string" ? t.title : "";
        const { artistFromTitle, titleWithoutArtist } = parseArtistAndTitle(rawTitle);
        const displayArtist = deriveDisplayArtist(resolvedArtistName, artistFromTitle);
        const cleanTitle = titleWithoutArtist || rawTitle || "Unknown title";

        return {
          key: `local:${trackId}`,
          title: cleanTitle,
          artist: displayArtist,
          youtubeId,
          trackId,
        } as SongResult;
      })
      .filter(Boolean) as SongResult[];
  }, [resolved, resolvedArtistName]);

  const resultsPlaylists = useMemo(() => {
    const localPlaylists = resolved?.local?.playlists || [];
    return { local: localPlaylists };
  }, [resolved]);

  async function runResolve(nextQuery: string, mode: SearchResolveMode) {
    const q = normalizeQuery(nextQuery);
    if (!q) return;

    resolveAbortRef.current?.abort();
    const controller = new AbortController();
    resolveAbortRef.current = controller;

    setResolveLoading(true);
    setError(null);

    try {
      const payload = { q, mode, sync: true };
      const next = await searchResolve(payload, { signal: controller.signal });
      if (!controller.signal.aborted) {
        setResolved(next);
      }
    } catch (e: any) {
      if (controller.signal.aborted) return;
      setResolved(null);
      setError(e?.message || "Search resolve failed");
    } finally {
      if (!controller.signal.aborted) setResolveLoading(false);
    }
  }

  const handleSuggestionClick = async (s: Suggestion) => {
    const nextMode: SearchResolveMode =
      s.type === "artist" ? "artist" : s.type === "track" ? "track" : s.type === "album" ? "album" : "generic";

    const nextQuery = (s.name || "").trim();
    if (!nextQuery) return;

    setQuery(nextQuery);
    setSuggestOpen(false);

    if (s.type === "track") {
      const artists = Array.isArray(s.artists) && s.artists.length > 0 ? s.artists : s.subtitle ? [s.subtitle] : [];
      setRelatedArtists(artists.length > 0 ? artists : null);
    } else {
      setRelatedArtists(null);
    }

    await runResolve(nextQuery, nextMode);

    const entityType: RecentSearchItem["entity_type"] =
      s.type === "artist"
        ? "artist"
        : s.type === "track"
          ? "song"
          : s.type === "playlist"
            ? "playlist"
            : s.type === "album"
              ? "album"
              : "generic";

    void persistRecentSearch({ query: nextQuery, entity_type: entityType, entity_id: s.id });
  };

  const handleRecentClick = async (item: RecentSearchItem) => {
    const normalized = normalizeQuery(item.query);
    if (!normalized) return;

    setQuery(normalized);
    setSuggestOpen(false);
    setRelatedArtists(null);

    await runResolve(normalized, "generic");
    void persistRecentSearch({ query: normalized, entity_type: item.entity_type, entity_id: item.entity_id });
  };

  const selectFirstSuggestion = useCallback(async () => {
    const first = flatSuggestions[0];
    if (!first) {
      setError("Pick a suggestion to search");
      return;
    }
    await handleSuggestionClick(first);
  }, [flatSuggestions, handleSuggestionClick]);

  const relatedArtistsKey = useMemo(() => (relatedArtists ? relatedArtists.join("|") : ""), [relatedArtists]);

  useEffect(() => {
    if (!relatedArtists || relatedArtists.length === 0) return;
    if (lastPrefetchedArtistsRef.current === relatedArtistsKey) return;
    lastPrefetchedArtistsRef.current = relatedArtistsKey;

    for (const name of relatedArtists) {
      prefetchArtist(name);
    }
  }, [relatedArtists, relatedArtistsKey]);

  const showResults = Boolean(resolved) || resolveLoading;

  const handleArtistClick = (artistName: string) => {
    const name = artistName.trim();
    if (!name) return;
    const key = deriveArtistKey(name);
    if (!key) return;
    const internal = `/artist/${encodeURIComponent(key)}`;
    try {
      navigate(internal);
    } catch {
      window.open(internal, "_blank", "noopener,noreferrer");
    }
  };

  const prefetchArtist = (artistName: string) => {
    const name = artistName.trim();
    if (!name) return;
    const key = deriveArtistKey(name);
    if (!key) return;
    prefetchArtistByKey(key);
  };

  const isEmptyResults =
    !resolveLoading &&
    Boolean(resolved) &&
    normalizedLength > 0 &&
    resultsSongs.length === 0 &&
    resultsPlaylists.local.length === 0 &&
    !resolvedArtistName;

  const showResolveError = Boolean(error) && showResults && !resolveLoading;

  const scrollKey = useMemo(
    () => `${location.pathname}${location.search}`,
    [location.pathname, location.search],
  );

  useEffect(() => {
    const container = document.querySelector("main") as HTMLElement | null;
    const getY = () => (container ? container.scrollTop : window.scrollY);

    const raw = sessionStorage.getItem(scrollKey);
    const saved = raw == null ? null : Number(raw);

    if (Number.isFinite(saved)) {
      requestAnimationFrame(() => {
        if (container) container.scrollTop = saved as number;
        else window.scrollTo({ top: saved as number, left: 0, behavior: "auto" });
      });
    }

    const onScroll = () => {
      if (tickingRef.current) return;
      tickingRef.current = true;

      requestAnimationFrame(() => {
        tickingRef.current = false;
        sessionStorage.setItem(scrollKey, String(getY()));
      });
    };

    const target: HTMLElement | Window = container ?? window;
    target.addEventListener("scroll", onScroll as EventListener, { passive: true });

    return () => {
      target.removeEventListener("scroll", onScroll as EventListener);
    };
  }, [scrollKey]);

  return (
    <div className="p-4 max-w-4xl mx-auto pb-32">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void selectFirstSuggestion();
        }}
        className="mb-6"
      >
        <div>
          <div className="flex gap-2">
            <div className="relative flex-1">
              <SearchIcon className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-muted-foreground" />
              <Input
                ref={inputRef}
                value={query}
                onChange={(e) => {
                  setQuery(e.target.value);
                  setSuggestOpen(true);
                }}
                onFocus={() => setSuggestOpen(true)}
                placeholder="Search songs, artists or playlists"
                className="pl-12 pr-10 h-12"
              />

              {normalizedLength > 0 ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  onClick={clearQuery}
                  aria-label="Clear search"
                  className="absolute right-1 top-1/2 -translate-y-1/2 h-10 w-10"
                >
                  <X className="h-4 w-4 text-muted-foreground" />
                </Button>
              ) : null}
            </div>

            {/* Search button removed: flow relies on suggestions */}
          </div>

          {showDropdown ? (
            <div
              className="absolute z-20 mt-2 w-full rounded-lg border border-border bg-card/95 backdrop-blur p-2"
              style={{ WebkitOverflowScrolling: "touch" }}
            >
              <div className="max-h-[60vh] overflow-y-auto overscroll-contain touch-pan-y space-y-3">
                  {showRecentsDropdown ? (
                  <div>
                    <div className="px-2 pb-2 text-xs text-muted-foreground">Recent searches</div>
                    <div className="space-y-1">
                        {filteredRecentSearches.map((item) => (
                        <button
                          key={item.id}
                          type="button"
                          onClick={() => void handleRecentClick(item)}
                          className="flex w-full items-center gap-3 rounded-md px-2 py-2 text-left hover:bg-accent"
                        >
                          <History className="h-4 w-4 text-muted-foreground" />
                          <div className="min-w-0">
                            <div className="font-medium truncate">{item.query}</div>
                            <div className="text-xs text-muted-foreground">
                              {recentEntityLabel(item.entity_type)} • Used {item.use_count}x
                            </div>
                          </div>
                        </button>
                      ))}
                    </div>
                  </div>
                ) : null}

                {showSuggestDropdown ? (
                  <div className="space-y-2">
                    {suggestIsFallback ? (
                      <div className="px-2 pb-2 text-xs text-muted-foreground">Showing local suggestions (Spotify unavailable).</div>
                    ) : null}

                    {suggestLoading ? <div className="px-2 py-2 text-sm text-muted-foreground">Searching...</div> : null}

                    {!suggestLoading && error && !showResults ? (
                      <div className="px-2 py-2 text-sm text-muted-foreground">{error}</div>
                    ) : null}

                    {!suggestLoading && !error && flatSuggestions.length === 0 ? (
                      <div className="px-2 py-2 text-sm text-muted-foreground">No suggestions.</div>
                    ) : null}

                    <div className="space-y-1">
                      {flatSuggestions.map((s) => (
                        <button
                          key={`${s.type}:${s.id}`}
                          type="button"
                          onClick={() => void handleSuggestionClick(s)}
                          className="w-full text-left flex items-center gap-3 rounded-md px-2 py-2 hover:bg-accent"
                        >
                          <div
                            className={`w-8 h-8 bg-muted overflow-hidden shrink-0 ${s.type === "artist" ? "rounded-full" : "rounded"}`}
                          >
                            <div className="w-full h-full flex items-center justify-center">
                              {s.imageUrl ? (
                                <img src={s.imageUrl} alt={s.name} className="w-full h-full object-cover" loading="lazy" />
                              ) : s.type === "artist" ? (
                                <User className="w-4 h-4 text-muted-foreground" />
                              ) : s.type === "track" ? (
                                <Music className="w-4 h-4 text-muted-foreground" />
                              ) : (
                                <ListMusic className="w-4 h-4 text-muted-foreground" />
                              )}
                            </div>
                          </div>

                          <div className="min-w-0 flex-1">
                            <div className="font-medium truncate">{s.name}</div>
                            <div className="text-xs text-muted-foreground truncate">
                              {s.type === "track" ? (s.subtitle ? `Song • ${s.subtitle}` : "Song") : suggestionTypeLabel(s.type)}
                            </div>
                          </div>
                        </button>
                      ))}
                    </div>
                  </div>
                ) : null}
              </div>
            </div>
          ) : null}
        </div>
      </form>

      {recentArtistsForShelf.length > 0 ? (
        <section className="mb-6">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-semibold text-muted-foreground">Recently searched artists</h2>
            <span className="text-xs text-muted-foreground">{recentArtistsForShelf.length} items</span>
          </div>
          <div className="flex gap-3 overflow-x-auto pb-1">
            {recentArtistsForShelf.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => {
                  const key = deriveArtistKey(item.query);
                  if (!key) return;
                  navigate(`/artist/${encodeURIComponent(key)}`);
                }}
                className="shrink-0 w-16 text-center"
              >
                <div className="mx-auto h-12 w-12 rounded-full bg-muted flex items-center justify-center overflow-hidden">
                  {recentArtistThumbs[item.query] ? (
                    <img src={recentArtistThumbs[item.query] as string} alt={item.query} className="h-full w-full object-cover" loading="lazy" />
                  ) : (
                    <span className="text-sm font-semibold text-muted-foreground">{firstLetter(item.query)}</span>
                  )}
                </div>
                <div className="mt-2 text-xs font-medium truncate">{item.query}</div>
              </button>
            ))}
          </div>
        </section>
      ) : null}

      {recentPlaylistsForShelf.length > 0 ? (
        <section className="mb-8 space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-muted-foreground">Recently viewed playlists</h2>
            <span className="text-xs text-muted-foreground">{recentPlaylistsForShelf.length} items</span>
          </div>

          <div className="space-y-2">
            {recentPlaylistsForShelf.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => void handleRecentClick(item)}
                className="flex w-full items-center gap-3 rounded-lg border border-border bg-card/40 px-3 py-3 text-left hover:bg-card/60"
              >
                <div className="h-12 w-12 rounded-lg bg-muted flex items-center justify-center overflow-hidden">
                  <ListMusic className="h-5 w-5 text-muted-foreground" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="font-semibold truncate">{item.query}</div>
                  <div className="text-xs text-muted-foreground">Playlist</div>
                </div>
              </button>
            ))}
          </div>
        </section>
      ) : null}

          {showRecent ? (
            <section className="space-y-3">
              <div className="flex items-center justify-between gap-3">
                <h2 className="text-xl font-bold">Recent searches</h2>
                {recentLoading ? <span className="text-xs text-muted-foreground">Loading…</span> : null}
                {!recentLoading && recentError ? <span className="text-xs text-destructive">{recentError}</span> : null}
              </div>

              {!recentLoading && recentSearches.length === 0 ? (
                <div className="rounded-lg border border-dashed border-border bg-muted/30 px-4 py-3 text-sm text-muted-foreground">
                  No recent searches yet. Try searching to see them here.
                </div>
              ) : null}

              <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
                {recentSearches.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => void handleRecentClick(item)}
                    className="group flex items-center justify-between gap-3 rounded-lg border border-border bg-card/40 px-3 py-3 text-left hover:bg-card/60"
                  >
                    <div className="flex flex-1 items-center gap-3 min-w-0">
                      <div className="flex h-10 w-10 items-center justify-center rounded-full bg-muted text-muted-foreground">
                        {item.entity_type === "artist" ? (
                          <User className="h-5 w-5" />
                        ) : item.entity_type === "song" ? (
                          <Music className="h-5 w-5" />
                        ) : item.entity_type === "playlist" ? (
                          <ListMusic className="h-5 w-5" />
                        ) : item.entity_type === "album" ? (
                          <Disc3 className="h-5 w-5" />
                        ) : (
                          <SearchIcon className="h-5 w-5" />
                        )}
                      </div>

                      <div className="min-w-0 flex-1">
                        <div className="truncate font-semibold">{item.query}</div>
                        <div className="text-xs text-muted-foreground">
                          {recentEntityLabel(item.entity_type)} • Used {item.use_count}x
                        </div>
                      </div>
                    </div>

                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 opacity-0 transition-opacity group-hover:opacity-100"
                      onClick={(e) => {
                        e.stopPropagation();
                        void handleDeleteRecent(item.id);
                      }}
                      aria-label="Remove recent search"
                    >
                      <X className="h-4 w-4 text-muted-foreground" />
                    </Button>
                  </button>
                ))}
              </div>
            </section>
          ) : null}

      {showResults ? (
        <div>
          {relatedArtists && relatedArtists.length > 0 ? (
            <section className="mb-10">
              <h2 className="flex items-center gap-2 text-xl font-bold mb-4">
                <User className="w-5 h-5" /> Artists
              </h2>

              <div className="flex gap-4 overflow-x-auto pb-2">
                {relatedArtists.map((name) => (
                  <button
                    key={name}
                    type="button"
                    onClick={() => handleArtistClick(name)}
                    onMouseEnter={() => prefetchArtist(name)}
                    onTouchStart={() => prefetchArtist(name)}
                    className="shrink-0 w-20 text-center"
                  >
                    <div className="mx-auto w-14 h-14 rounded-full bg-muted overflow-hidden flex items-center justify-center">
                      <span className="text-sm font-semibold text-muted-foreground">{firstLetter(name)}</span>
                    </div>
                    <div className="mt-2 text-xs font-medium truncate">{name}</div>
                    <div className="mt-1 text-[10px] text-muted-foreground inline-flex items-center justify-center gap-1">
                      <User className="w-3 h-3" /> <span>Artist</span>
                    </div>
                  </button>
                ))}
              </div>
            </section>
          ) : null}

          {resolveLoading ? (
            <LoadingSkeleton type="search" />
          ) : showResolveError ? (
            <ErrorState title="Search failed" subtitle="Please try again" onRetry={() => void selectFirstSuggestion()} />
          ) : isEmptyResults ? (
            <EmptyState title="No results found" subtitle="Try a different artist, song, or playlist" />
          ) : resolved ? (
            <div>
              <section className="mb-8 min-h-[104px]">
                {resolvedArtistName ? (
                  <div>
                    <div className="mb-2 text-xs text-muted-foreground">Artist</div>
                    <div className="flex gap-4 overflow-x-auto pb-2">
                      <button
                        type="button"
                        onClick={() => handleArtistClick(resolvedArtistName)}
                        onMouseEnter={() => prefetchArtist(resolvedArtistName)}
                        onTouchStart={() => prefetchArtist(resolvedArtistName)}
                        className="shrink-0 w-20 text-center"
                      >
                        <div className="mx-auto w-14 h-14 rounded-full bg-muted overflow-hidden flex items-center justify-center">
                          {resolvedArtistThumb ? (
                            <img src={resolvedArtistThumb} alt={resolvedArtistName} className="w-full h-full object-cover" loading="lazy" />
                          ) : (
                            <span className="text-sm font-semibold text-muted-foreground">{firstLetter(resolvedArtistName)}</span>
                          )}
                        </div>
                        <div className="mt-2 text-xs font-medium truncate">{resolvedArtistName}</div>
                        <div className="mt-1 text-[10px] text-muted-foreground inline-flex items-center justify-center gap-1">
                          <User className="w-3 h-3" /> <span>Artist</span>
                        </div>
                      </button>
                    </div>
                  </div>
                ) : null}
              </section>

              {resultsSongs.length > 0 ? (
                <section className="mb-10">
                  <h2 className="flex items-center gap-2 text-xl font-bold mb-4">
                    <Music className="w-5 h-5" /> Songs
                  </h2>

                  <div className="space-y-2">
                    {resultsSongs.map((s) => (
                      <button
                        key={s.key}
                        type="button"
                        onClick={() => playTrack(s.youtubeId, s.title, s.artist, s.trackId)}
                        className="block w-full text-left rounded-lg border border-border bg-card/30 px-3 py-3 hover:bg-card/50 transition-colors"
                      >
                        <div className="font-medium truncate">{s.title}</div>
                        <div className="text-sm text-muted-foreground truncate">{s.artist}</div>
                      </button>
                    ))}
                  </div>
                </section>
              ) : null}

              {resultsPlaylists.local.length > 0 ? (
                <section>
                  <h2 className="flex items-center gap-2 text-xl font-bold mb-4">
                    <ListMusic className="w-5 h-5" /> Playlists
                  </h2>

                  <div className="space-y-2">
                    {resultsPlaylists.local.map((p) => (
                      <Link
                        key={p.id}
                        to={`/playlist/${p.id}`}
                        className="block w-full rounded-lg border border-border bg-card/30 px-3 py-3 hover:bg-card/50 transition-colors"
                      >
                        <div className="font-medium truncate">{p.title}</div>
                      </Link>
                    ))}
                  </div>
                </section>
              ) : null}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
