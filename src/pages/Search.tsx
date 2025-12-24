import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { ListMusic, Music, Search as SearchIcon, User, X } from "lucide-react";
import debounce from "lodash.debounce";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import EmptyState from "@/components/ui/EmptyState";
import ErrorState from "@/components/ui/ErrorState";
import LoadingSkeleton from "@/components/ui/LoadingSkeleton";
import { usePlayer } from "@/contexts/PlayerContext";
import {
  searchResolve,
  searchSuggest,
  type SearchResolveResponse,
  type SearchSuggestResponse,
} from "@/lib/api/search";
import { prefetchArtistByKey } from "@/lib/api/artist";
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

export default function Search() {
  const { playTrack } = usePlayer();
  const navigate = useNavigate();
  const location = useLocation();

  const [query, setQuery] = useState("");
  const [suggestions, setSuggestions] = useState<SearchSuggestResponse | null>(null);
  const [suggestLoading, setSuggestLoading] = useState(false);
  const [suggestOpen, setSuggestOpen] = useState(false);

  const [resolved, setResolved] = useState<SearchResolveResponse | null>(null);
  const [resolveLoading, setResolveLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const suggestAbortRef = useRef<AbortController | null>(null);
  const resolveAbortRef = useRef<AbortController | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const clearQuery = () => {
    suggestAbortRef.current?.abort();
    resolveAbortRef.current?.abort();

    setQuery("");
    setSuggestOpen(false);
    setSuggestions(null);
    setSuggestLoading(false);

    setResolved(null);
    setResolveLoading(false);
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
    const q = normalizeQuery(query);

    if (q.length < 2) {
      debouncedSearchSuggest.cancel();
      suggestAbortRef.current?.abort();
      setSuggestions(null);
      setSuggestLoading(false);
      return;
    }

    debouncedSearchSuggest(q);
  }, [query, debouncedSearchSuggest]);

  const suggestIsFallback = suggestions?.source === "local_fallback";

  const groupedSuggestions: Suggestion[] = useMemo(() => {
    if (!suggestions) return [];

    const source = Array.isArray(suggestions.suggestions) ? suggestions.suggestions : [];
    const artists: Suggestion[] = [];
    const tracks: Suggestion[] = [];
    const playlists: Suggestion[] = [];

    for (const raw of source) {
      if (!raw || typeof raw !== "object") continue;
      const s = raw as Suggestion;
      if (!s.id || !s.type || !s.name || !s.name.trim()) continue;

      if (s.type === "artist") artists.push(s);
      else if (s.type === "track") tracks.push(s);
      else if (s.type === "playlist") playlists.push(s);
    }

    const maxItems = 12;
    const output: Suggestion[] = [];
    let ai = 0;
    let ti = 0;
    let pi = 0;

    while (output.length < maxItems && (ai < artists.length || ti < tracks.length || pi < playlists.length)) {
      if (ai < artists.length && output.length < maxItems) {
        output.push(artists[ai]);
        ai += 1;
      }

      for (let i = 0; i < 2 && ti < tracks.length && output.length < maxItems; i += 1) {
        output.push(tracks[ti]);
        ti += 1;
      }

      for (let i = 0; i < 2 && pi < playlists.length && output.length < maxItems; i += 1) {
        output.push(playlists[pi]);
        pi += 1;
      }

      if (ai >= artists.length && ti >= tracks.length && pi >= playlists.length) break;
    }

    return output;
  }, [suggestions]);

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
        const rawTitle = typeof t?.title === "string" ? t.title.trim() : "";
        const title = rawTitle || "Unknown title";
        const rawArtist = typeof t?.artist === "string" ? t.artist.trim() : "";
        const artist = rawArtist || "Unknown artist";

        return {
          key: `local:${trackId}`,
          title,
          artist,
          youtubeId,
          trackId,
        } as SongResult;
      })
      .filter(Boolean) as SongResult[];
  }, [resolved]);

  const resultsPlaylists = useMemo(() => {
    const localPlaylists = resolved?.local?.playlists || [];
    return { local: localPlaylists };
  }, [resolved]);

  async function runResolve(nextQuery: string) {
    const q = normalizeQuery(nextQuery);
    if (!q) return;

    resolveAbortRef.current?.abort();
    const controller = new AbortController();
    resolveAbortRef.current = controller;

    setResolveLoading(true);
    setError(null);

    try {
      const payload = { q, mode: "generic" as const, sync: true };
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

  const handleSubmit = async () => {
    setSuggestOpen(false);
    await runResolve(query);
  };

  const handleSuggestionClick = async () => {
    setSuggestOpen(false);
    await runResolve(query);
  };

  const showSuggestBox = suggestOpen && normalizeQuery(query).length >= 2;
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
    normalizeQuery(query).length > 0 &&
    resultsSongs.length === 0 &&
    resultsPlaylists.local.length === 0;

  const showResolveError = Boolean(error) && showResults && !resolveLoading;

  const scrollKey = useMemo(
    () => `${location.pathname}${location.search}`,
    [location.pathname, location.search],
  );

  const tickingRef = useRef(false);

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
          void handleSubmit();
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

              {normalizeQuery(query).length > 0 ? (
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

            <Button type="submit" className="h-12">
              Search
            </Button>
          </div>

          {showSuggestBox ? (
            <div
              className="absolute z-20 mt-2 w-full rounded-lg border border-border bg-card/95 backdrop-blur p-2"
              style={{ WebkitOverflowScrolling: "touch" }}
            >
              {suggestIsFallback ? (
                <div className="px-2 pb-2 text-xs text-muted-foreground">Showing local suggestions (Spotify unavailable).</div>
              ) : null}

              {suggestLoading ? <div className="px-2 py-2 text-sm text-muted-foreground">Searching…</div> : null}

              {!suggestLoading && error && !showResults ? (
                <div className="px-2 py-2 text-sm text-muted-foreground">{error}</div>
              ) : null}

              {!suggestLoading && !error && groupedSuggestions.length === 0 ? (
                <div className="px-2 py-2 text-sm text-muted-foreground">No suggestions.</div>
              ) : null}

              <div className="max-h-[60vh] overflow-y-auto overscroll-contain touch-pan-y">
                {groupedSuggestions.map((s) => (
                  <button
                    key={`${s.type}:${s.id}`}
                    type="button"
                    onClick={() => void handleSuggestionClick()}
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
                        {s.type === "track" ? "Song" : suggestionTypeLabel(s.type)}
                      </div>
                    </div>
                  </button>
                ))}
              </div>
            </div>
          ) : null}
        </div>
      </form>

      {showResults ? (
        <div>
          {resolveLoading ? (
            <LoadingSkeleton type="search" />
          ) : showResolveError ? (
            <ErrorState title="Search failed" subtitle="Please try again" onRetry={() => void handleSubmit()} />
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
}import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { ListMusic, Music, Search as SearchIcon, User, X } from "lucide-react";
import debounce from "lodash.debounce";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import EmptyState from "@/components/ui/EmptyState";
import ErrorState from "@/components/ui/ErrorState";
import LoadingSkeleton from "@/components/ui/LoadingSkeleton";
import { usePlayer } from "@/contexts/PlayerContext";
import {
  searchResolve,
  searchSuggest,
  type SearchResolveResponse,
  type SearchSuggestResponse,
} from "@/lib/api/search";
import { prefetchArtistByKey } from "@/lib/api/artist";
import { deriveArtistKey } from "@/lib/artistKey";
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
    // Search mora raditi i za goste (bez login gate-a).
    const { playTrack } = usePlayer();
    const navigate = useNavigate();
    const location = useLocation();

    const [query, setQuery] = useState("");

    const [suggestions, setSuggestions] = useState<SearchSuggestResponse | null>(null);
    const [suggestLoading, setSuggestLoading] = useState(false);
    const [suggestOpen, setSuggestOpen] = useState(false);

    const [resolved, setResolved] = useState<SearchResolveResponse | null>(null);
    const [resolveLoading, setResolveLoading] = useState(false);

    // When a track suggestion is clicked, show/prefetch all connected artists under Search.
    const [relatedArtists, setRelatedArtists] = useState<string[] | null>(null);

    const [error, setError] = useState<string | null>(null);

    const suggestAbortRef = useRef<AbortController | null>(null);
    const resolveAbortRef = useRef<AbortController | null>(null);
    const inputRef = useRef<HTMLInputElement | null>(null);

    const clearQuery = () => {
      // Cancel any in-flight requests and pending retries.
      suggestAbortRef.current?.abort();
      resolveAbortRef.current?.abort();

      setQuery("");
      setSuggestOpen(false);
      setSuggestions(null);
      setSuggestLoading(false);

      setResolved(null);
      setResolveLoading(false);
      setError(null);
      setRelatedArtists(null);

      requestAnimationFrame(() => {
        inputRef.current?.focus();
      });
    };

    const debouncedSearchSuggest = useMemo(
      () =>
        debounce((q: string) => {
          // Cancel any in-flight request before starting a new one.
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
      // Cleanup on unmount.
      return () => {
        debouncedSearchSuggest.cancel();
        suggestAbortRef.current?.abort();
      };
    }, [debouncedSearchSuggest]);

    useEffect(() => {
      const q = normalizeQuery(query);

      if (q.length < 2) {
        debouncedSearchSuggest.cancel();
        suggestAbortRef.current?.abort();
        setSuggestions(null);
        setSuggestLoading(false);
        return;
      }

      debouncedSearchSuggest(q);
    }, [query, debouncedSearchSuggest]);

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

    const handleSubmit = async () => {
      setSuggestOpen(false);
      setRelatedArtists(null);
      await runResolve(query, "generic");
    };

    const handleSuggestionClick = async (s: Suggestion) => {
      const nextMode: SearchResolveMode = s.type === "artist" ? "artist" : s.type === "track" ? "track" : s.type === "album" ? "album" : "generic";
      const nextQuery = s.type === "track" && s.subtitle ? `${s.name} ${s.subtitle}` : s.name;
      setQuery(nextQuery);
      setSuggestOpen(false);

      if (s.type === "track") {
        const artists = Array.isArray(s.artists) && s.artists.length > 0 ? s.artists : s.subtitle ? [s.subtitle] : [];
        setRelatedArtists(artists.length > 0 ? artists : null);
      } else {
        setRelatedArtists(null);
      }

      await runResolve(nextQuery, nextMode);
    };

    const relatedArtistsKey = useMemo(() => (relatedArtists ? relatedArtists.join("|") : ""), [relatedArtists]);
    const lastPrefetchedArtistsRef = useRef<string>("");

    useEffect(() => {
      if (!relatedArtists || relatedArtists.length === 0) return;
      if (lastPrefetchedArtistsRef.current === relatedArtistsKey) return;
      lastPrefetchedArtistsRef.current = relatedArtistsKey;

      for (const name of relatedArtists) {
        prefetchArtist(name);
      }
    }, [relatedArtists, relatedArtistsKey]);

    const showSuggestBox = suggestOpen && normalizeQuery(query).length >= 2;
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
      // Warm browser + backend cache; best-effort.
      prefetchArtistByKey(key);
    };

    const isEmptyResults =
      !resolveLoading &&
      Boolean(resolved) &&
      normalizeQuery(query).length > 0 &&
      resultsSongs.length === 0 &&
      resultsPlaylists.local.length === 0;

    const showResolveError = Boolean(error) && showResults && !resolveLoading;

    const scrollKey = useMemo(
      () => `${location.pathname}${location.search}`,
      [location.pathname, location.search],
    );

    const tickingRef = useRef(false);

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
            void handleSubmit();
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

                {normalizeQuery(query).length > 0 ? (
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

              <Button type="submit" className="h-12">
                Search
              </Button>
            </div>

            {showSuggestBox ? (
              <div
                className="absolute z-20 mt-2 w-full rounded-lg border border-border bg-card/95 backdrop-blur p-2"
                // iOS-friendly scrolling for overflow containers.
                style={{ WebkitOverflowScrolling: "touch" }}
              >
                {suggestIsFallback ? (
                  <div className="px-2 pb-2 text-xs text-muted-foreground">
                    Showing local suggestions (Spotify unavailable).
                  </div>
                ) : null}

                {suggestLoading ? <div className="px-2 py-2 text-sm text-muted-foreground">Searching…</div> : null}

                {!suggestLoading && error && !showResults ? (
                  <div className="px-2 py-2 text-sm text-muted-foreground">{error}</div>
                ) : null}

                {!suggestLoading && !error && flatSuggestions.length === 0 ? (
                  <div className="px-2 py-2 text-sm text-muted-foreground">No suggestions.</div>
                ) : null}

                <div className="max-h-[60vh] overflow-y-auto overscroll-contain touch-pan-y">
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
        </form>

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
              <ErrorState title="Search failed" subtitle="Please try again" onRetry={() => void handleSubmit()} />
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
