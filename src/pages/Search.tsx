import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { Disc3, History, ListMusic, Music, Search as SearchIcon, User, X, Heart, Eye } from "lucide-react";
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
import { useQuery } from "@tanstack/react-query";
import { withBackendOrigin } from "@/lib/backendUrl";
import { externalSupabase } from "@/lib/externalSupabase";
import { deriveArtistKey } from "@/lib/artistKey";
import { usePlaylistPublicStats } from "@/hooks/usePlaylistPublicStats";

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
  imageUrl?: string | null;
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

function deriveDisplayArtist(
  resolvedArtistName: string | null,
  artistFromTitle: string | null,
  suggestedArtist: string | null,
): string {
  if (resolvedArtistName) return resolvedArtistName;
  if (suggestedArtist) return suggestedArtist;
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
  const resolveCacheRef = useRef<Map<string, SearchResolveResponse>>(new Map());
  const [resolveLoading, setResolveLoading] = useState(false);

  const [recentSearches, setRecentSearches] = useState<RecentSearchItem[]>([]);
  const [recentLoading, setRecentLoading] = useState(false);
  const [recentError, setRecentError] = useState<string | null>(null);
  const [recentArtistThumbs, setRecentArtistThumbs] = useState<Record<string, string | null>>({});
  const [recentPlaylistError, setRecentPlaylistError] = useState<string | null>(null);

  const [relatedArtists, setRelatedArtists] = useState<string[] | null>(null);
  const [selectedTrackArtists, setSelectedTrackArtists] = useState<string[] | null>(null);
  const [artistImageUrl, setArtistImageUrl] = useState<string | null>(null);
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
  const showRecent = false;

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
    setSelectedTrackArtists(null);
    setArtistImageUrl(null);
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

  type RecentPlaylist = { id: string; title: string; cover_url: string | null; last_viewed_at?: string };

  const { data: recentPlaylistsForShelf = [], isLoading: recentPlaylistsLoading } = useQuery<RecentPlaylist[], Error>({
    queryKey: ["recent-playlists-search", userId],
    enabled: Boolean(userId),
    queryFn: async () => {
      const uid = userId;
      if (!uid) return [];

      const url = withBackendOrigin(`/api/playlist-views/top?user_id=${encodeURIComponent(uid)}&limit=20`);
      const response = await fetch(url, { credentials: "include", headers: { "Content-Type": "application/json" } });
      if (!response.ok) {
        setRecentPlaylistError("Failed to load recent playlists");
        return [];
      }

      const payload = await response.json().catch(() => null);
      type BackendPlaylistItem = {
        playlist_id?: string;
        playlists?: { id?: string; title?: string; cover_url?: string | null };
        playlist?: { id?: string; title?: string; cover_url?: string | null };
        last_viewed_at?: string;
      };

      const items: BackendPlaylistItem[] = Array.isArray(payload?.playlists) ? (payload!.playlists as BackendPlaylistItem[]) : [];
      return items
        .map((item) => {
          const pl = item.playlists || item.playlist || {};
          const id = pl.id || item.playlist_id || "";
          if (!id) return null;
          return {
            id,
            title: pl.title || "Unknown playlist",
            cover_url: pl.cover_url ?? null,
            last_viewed_at: item.last_viewed_at,
          } satisfies RecentPlaylist;
        })
        .filter((p): p is RecentPlaylist => Boolean(p))
        .slice(0, 20);
    },
  });

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

  const primarySelectedArtist = useMemo(() => {
    const first = selectedTrackArtists && selectedTrackArtists.length > 0 ? selectedTrackArtists[0] : null;
    return first ? first.trim() || null : null;
  }, [selectedTrackArtists]);

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
        const displayArtist = deriveDisplayArtist(resolvedArtistName, artistFromTitle, primarySelectedArtist);
        const cleanTitle = titleWithoutArtist || rawTitle || "Unknown title";
        const imageUrlCandidate = typeof t?.coverUrl === "string" ? t.coverUrl : (t as any)?.cover_url;
        const imageUrl = imageUrlCandidate && imageUrlCandidate.trim().length > 0 ? imageUrlCandidate.trim() : null;

        return {
          key: `local:${trackId}`,
          title: cleanTitle,
          artist: displayArtist,
          youtubeId,
          trackId,
          imageUrl,
        } as SongResult;
      })
      .filter(Boolean) as SongResult[];
  }, [primarySelectedArtist, resolved, resolvedArtistName]);

  const resolvedArtistThumb = useMemo(() => {
    const direct = (() => {
      const url = resolved?.artist?.thumbnail_url;
      return typeof url === "string" && url.trim() ? url.trim() : null;
    })();

    const songThumb = (() => {
      const candidate = resultsSongs[0]?.imageUrl;
      return typeof candidate === "string" && candidate.trim() ? candidate.trim() : null;
    })();

    return direct || artistImageUrl || songThumb || null;
  }, [artistImageUrl, resolved, resultsSongs]);

  const displayArtistName = resolvedArtistName || primarySelectedArtist || null;

  const resultsPlaylists = useMemo(() => {
    const localPlaylists = resolved?.local?.playlists || [];
    return { local: localPlaylists };
  }, [resolved]);

  const interleavedResults = useMemo(() => {
    const songs = resultsSongs;
    const playlists = resultsPlaylists.local;
    const out: Array<{ kind: "song"; song: SongResult } | { kind: "playlist"; playlist: typeof playlists[number] }> = [];
    let si = 0;
    let pi = 0;
    while (si < songs.length || pi < playlists.length) {
      if (si < songs.length) {
        const chunk = songs.slice(si, si + 2);
        for (const s of chunk) out.push({ kind: "song", song: s });
        si += 2;
      }
      if (pi < playlists.length) {
        const chunk = playlists.slice(pi, pi + 2);
        for (const p of chunk) out.push({ kind: "playlist", playlist: p });
        pi += 2;
      }
    }
    return out;
  }, [resultsPlaylists.local, resultsSongs]);

  const playlistResultIds = useMemo(() => {
    return interleavedResults
      .filter((item): item is { kind: "playlist"; playlist: any } => item.kind === "playlist" && item.playlist?.id)
      .map((item) => String(item.playlist.id));
  }, [interleavedResults]);

  const { data: resultStats = {} } = usePlaylistPublicStats(playlistResultIds);

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
        resolveCacheRef.current.set(q.toLowerCase(), next);
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
      const nextArtists = artists.length > 0 ? artists : null;
      setRelatedArtists(nextArtists);
      setSelectedTrackArtists(nextArtists);
      setArtistImageUrl(null);
    } else {
      setRelatedArtists(null);
      setSelectedTrackArtists(null);
      setArtistImageUrl(s.type === "artist" ? (s.imageUrl?.trim() || null) : null);
    }

    const cached = resolveCacheRef.current.get(nextQuery.toLowerCase());
    if (cached) {
      setResolved(cached);
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
    setSelectedTrackArtists(null);
    setArtistImageUrl(null);

    const cached = resolveCacheRef.current.get(normalized.toLowerCase());
    if (cached) {
      setResolved(cached);
    }

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
              <SearchIcon className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-[#F6C66D]" />
              <Input
                ref={inputRef}
                value={query}
                onChange={(e) => {
                  setQuery(e.target.value);
                  setSuggestOpen(true);
                }}
                onFocus={() => setSuggestOpen(true)}
                placeholder="Search songs, artists or playlists"
                className="pl-12 pr-10 h-12 rounded-[16px] bg-[rgba(255,255,255,0.06)] border border-[rgba(255,255,255,0.08)] text-foreground placeholder:text-[#8B86A3] shadow-[0_10px_30px_rgba(0,0,0,0.35)]"
              />

              {normalizedLength > 0 ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  onClick={clearQuery}
                  aria-label="Clear search"
                  className="absolute right-1 top-1/2 -translate-y-1/2 h-10 w-10 text-[#B7B2CC] hover:text-[#F3F1FF]"
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

      {!showResults && recentArtistsForShelf.length > 0 ? (
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

      {!showResults && recentPlaylistsForShelf.length > 0 ? (
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
                onClick={() => navigate(`/playlist/${item.id}`)}
                className="flex w-full items-center gap-3 rounded-lg border border-border bg-card/40 px-3 py-3 text-left hover:bg-card/60"
              >
                <div className="h-12 w-12 rounded-lg bg-muted flex items-center justify-center overflow-hidden">
                  {item.cover_url ? (
                    <img src={item.cover_url} alt={item.title} className="h-full w-full object-cover" loading="lazy" />
                  ) : (
                    <ListMusic className="h-5 w-5 text-muted-foreground" />
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="font-semibold truncate">{item.title}</div>
                  <div className="text-xs text-muted-foreground">Playlist</div>
                </div>
              </button>
            ))}
          </div>
        </section>
      ) : null}

          {/* recent searches grid removed from page body; recents only live inside dropdown */}

      {showResults ? (
        <div>
          {/* related artists list suppressed; only show resolved artist/playlist/song results below */}

          {resolveLoading ? (
            <LoadingSkeleton type="search" />
          ) : showResolveError ? (
            <ErrorState title="Search failed" subtitle="Please try again" onRetry={() => void selectFirstSuggestion()} />
          ) : isEmptyResults ? (
            <EmptyState title="No results found" subtitle="Try a different artist, song, or playlist" />
          ) : resolved ? (
            <div>
              <section className="mb-8 min-h-[104px]">
                {displayArtistName ? (
                  <div>
                    <div className="mb-2 text-xs text-muted-foreground">Artist</div>
                    <div className="flex gap-4 overflow-x-auto pb-2">
                      <button
                        type="button"
                        onClick={() => handleArtistClick(displayArtistName)}
                        onMouseEnter={() => prefetchArtist(displayArtistName)}
                        onTouchStart={() => prefetchArtist(displayArtistName)}
                        className="shrink-0 w-20 text-center"
                      >
                        <div className="mx-auto w-14 h-14 rounded-full bg-muted overflow-hidden flex items-center justify-center">
                          {resolvedArtistThumb ? (
                            <img src={resolvedArtistThumb} alt={displayArtistName} className="w-full h-full object-cover" loading="lazy" />
                          ) : (
                            <span className="text-sm font-semibold text-muted-foreground">{firstLetter(displayArtistName)}</span>
                          )}
                        </div>
                        <div className="mt-2 text-xs font-medium truncate">{displayArtistName}</div>
                        <div className="mt-1 text-[10px] text-muted-foreground inline-flex items-center justify-center gap-1">
                          <User className="w-3 h-3" /> <span>Artist</span>
                        </div>
                      </button>
                    </div>
                  </div>
                ) : null}
              </section>

              {interleavedResults.length > 0 ? (
                <section className="space-y-2">
                  <h2 className="flex items-center gap-2 text-xl font-bold mb-4">
                    <Music className="w-5 h-5" /> Songs & Playlists
                  </h2>

                  {interleavedResults.map((item, idx) => {
                    if (item.kind === "song") {
                      const artist = item.song.artist || "Unknown artist";
                      const thumb = item.song.imageUrl || null;
                      return (
                        <button
                          key={`song-${item.song.key}-${idx}`}
                          type="button"
                          onClick={() => playTrack(item.song.youtubeId, item.song.title, item.song.artist, item.song.trackId)}
                          className="block w-full text-left rounded-lg border border-border bg-card/30 px-3 py-3 hover:bg-card/50 transition-colors"
                        >
                          <div className="flex items-center gap-3">
                            <div className="h-12 w-12 rounded-lg bg-muted flex items-center justify-center overflow-hidden">
                              {thumb ? (
                                <img src={thumb} alt={item.song.title} className="h-full w-full object-cover" loading="lazy" />
                              ) : (
                                <Music className="h-5 w-5 text-muted-foreground" />
                              )}
                            </div>
                            <div className="min-w-0 flex-1">
                              <div className="font-medium truncate">{item.song.title}</div>
                              <div className="text-sm text-muted-foreground truncate">Song • {artist}</div>
                            </div>
                          </div>
                        </button>
                      );
                    }

                    const playlistArtist = displayArtistName || "Various artists";
                    const cover = (item.playlist as any)?.cover_url ?? (item.playlist as any)?.coverUrl ?? null;
                    const stats = resultStats[item.playlist.id] ?? { likes: 0, views: 0 };
                    return (
                      <Link
                        key={`playlist-${item.playlist.id}-${idx}`}
                        to={`/playlist/${item.playlist.id}`}
                        className="block w-full rounded-lg border border-border bg-card/30 px-3 py-3 hover:bg-card/50 transition-colors"
                      >
                        <div className="flex items-center gap-3">
                          <div className="h-12 w-12 rounded-lg bg-muted flex items-center justify-center overflow-hidden">
                            {cover ? (
                              <img src={cover} alt={item.playlist.title} className="h-full w-full object-cover" loading="lazy" />
                            ) : (
                              <ListMusic className="h-5 w-5 text-muted-foreground" />
                            )}
                          </div>
                          <div className="min-w-0 flex-1">
                            <div className="font-medium truncate">{item.playlist.title}</div>
                            <div className="text-sm text-muted-foreground truncate">Playlist • {playlistArtist}</div>
                            <div className="mt-1 flex items-center justify-between text-[11px] text-muted-foreground">
                              <span className="flex items-center gap-1">
                                <Heart className="h-3 w-3" />
                                <span>{stats.likes.toLocaleString()}</span>
                              </span>
                              <span className="flex items-center gap-1">
                                <Eye className="h-3 w-3" />
                                <span>{stats.views.toLocaleString()}</span>
                              </span>
                            </div>
                          </div>
                        </div>
                      </Link>
                    );
                  })}
                </section>
              ) : null}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
