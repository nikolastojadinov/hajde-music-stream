import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { ListMusic, Music, Search as SearchIcon, User, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import EmptyState from "@/components/ui/EmptyState";
import ErrorState from "@/components/ui/ErrorState";
import LoadingSkeleton from "@/components/ui/LoadingSkeleton";
import { usePlayer } from "@/contexts/PlayerContext";
import {
  searchResolve,
  searchSuggest,
  type SearchResolveMode,
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
};

function normalizeQuery(value: string): string {
  return value.trim();
}

function firstLetter(title: string): string {
  const trimmed = title.trim();
  if (!trimmed) return "?";
  return trimmed[0]?.toUpperCase() ?? "?";
}

export default function Search() {
  // Search mora raditi i za goste (bez login gate-a).
  const { playTrack } = usePlayer();
  const navigate = useNavigate();
  const location = useLocation();

  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");

  const [suggestions, setSuggestions] = useState<SearchSuggestResponse | null>(null);
  const [suggestLoading, setSuggestLoading] = useState(false);
  const [suggestOpen, setSuggestOpen] = useState(false);

  const [resolved, setResolved] = useState<SearchResolveResponse | null>(null);
  const [resolveLoading, setResolveLoading] = useState(false);

  const [error, setError] = useState<string | null>(null);

  const suggestAbortRef = useRef<AbortController | null>(null);
  const resolveAbortRef = useRef<AbortController | null>(null);
  const resolveRetryTimersRef = useRef<number[]>([]);
  const resolveRequestIdRef = useRef(0);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const clearQuery = () => {
    // Cancel any in-flight requests and pending retries.
    suggestAbortRef.current?.abort();
    resolveAbortRef.current?.abort();
    resolveRetryTimersRef.current.forEach((t) => window.clearTimeout(t));
    resolveRetryTimersRef.current = [];
    resolveRequestIdRef.current += 1;

    setQuery("");
    setDebouncedQuery("");
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

  useEffect(() => {
    const t = window.setTimeout(() => setDebouncedQuery(normalizeQuery(query)), 250);
    return () => window.clearTimeout(t);
  }, [query]);

  useEffect(() => {
    const q = debouncedQuery;
    if (q.length < 2) {
      suggestAbortRef.current?.abort();
      setSuggestions(null);
      setSuggestLoading(false);
      return;
    }

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
  }, [debouncedQuery]);

  const flatSuggestions: Suggestion[] = useMemo(() => {
    if (!suggestions) return [];

    const maxItems = 12;
    return (Array.isArray(suggestions.suggestions) ? suggestions.suggestions : [])
      .filter((s) => Boolean(s && typeof s === "object"))
      .map((s) => s as Suggestion)
      .filter((s) => Boolean(s.id && s.name && s.name.trim() && s.type))
      .slice(0, maxItems);
  }, [suggestions]);

  const resultsSongs = useMemo(() => {
    const localTracks = resolved?.local?.tracks || [];

    const local = localTracks
      .filter((t) => t.externalId)
      .map((t) => ({
        key: `local:${t.id}`,
        title: t.title,
        artist: t.artist,
        youtubeId: t.externalId as string,
        trackId: t.id,
      }));

    return local;
  }, [resolved]);

  const resultsPlaylists = useMemo(() => {
    const localPlaylists = resolved?.local?.playlists || [];
    return { local: localPlaylists };
  }, [resolved]);

  const ingestedArtistName = useMemo(() => {
    const name = resolved?.artist_name ? resolved.artist_name.trim() : "";
    return name || null;
  }, [resolved]);

  const ingestedArtistThumb = useMemo(() => {
    const url = resolved?.artist?.thumbnail_url;
    return typeof url === "string" && url.trim() ? url.trim() : null;
  }, [resolved]);

  async function runResolve(nextQuery: string, mode: SearchResolveMode) {
    const q = normalizeQuery(nextQuery);
    if (!q) return;

    // Cancel any pending silent retries from a previous query.
    resolveRetryTimersRef.current.forEach((t) => window.clearTimeout(t));
    resolveRetryTimersRef.current = [];
    resolveRequestIdRef.current += 1;
    const requestId = resolveRequestIdRef.current;

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
    await runResolve(query, "generic");
  };

  const handleSuggestionClick = async (s: Suggestion) => {
    const nextMode: SearchResolveMode = s.type === "artist" ? "artist" : s.type === "track" ? "track" : s.type === "album" ? "album" : "generic";
    const nextQuery = s.type === "track" && s.subtitle ? `${s.name} ${s.subtitle}` : s.name;
    setQuery(nextQuery);
    setSuggestOpen(false);
    await runResolve(nextQuery, nextMode);
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
            <div className="absolute z-20 mt-2 w-full rounded-lg border border-border bg-card/95 backdrop-blur p-2">
              {suggestLoading ? <div className="px-2 py-2 text-sm text-muted-foreground">Searching…</div> : null}

              {!suggestLoading && error && !showResults ? (
                <div className="px-2 py-2 text-sm text-muted-foreground">{error}</div>
              ) : null}

              {!suggestLoading && !error && flatSuggestions.length === 0 ? (
                <div className="px-2 py-2 text-sm text-muted-foreground">No suggestions.</div>
              ) : null}

              <div>
                {flatSuggestions.map((s) => (
                  <button
                    key={`${s.type}:${s.id}`}
                    type="button"
                    onClick={() => void handleSuggestionClick(s)}
                    className="w-full text-left flex items-center gap-3 rounded-md px-2 py-2 hover:bg-accent"
                  >
                    <div className="w-8 h-8 rounded bg-muted overflow-hidden shrink-0">
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
                        {s.subtitle ? `${s.subtitle} · Spotify` : "Spotify"}
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
              {/* Artist chip: ONLY when backend confirms ingestion trigger */}
              <section className="mb-8 min-h-[104px]">
                {ingestedArtistName ? (
                  <div>
                    <div className="mb-2 text-xs text-muted-foreground">Artist</div>
                    <div className="flex gap-4 overflow-x-auto pb-2">
                      <button
                        type="button"
                        onClick={() => handleArtistClick(ingestedArtistName)}
                        onMouseEnter={() => prefetchArtist(ingestedArtistName)}
                        onTouchStart={() => prefetchArtist(ingestedArtistName)}
                        className="shrink-0 w-20 text-center"
                      >
                        <div className="mx-auto w-14 h-14 rounded-full bg-muted overflow-hidden flex items-center justify-center">
                          {ingestedArtistThumb ? (
                            <img src={ingestedArtistThumb} alt={ingestedArtistName} className="w-full h-full object-cover" loading="lazy" />
                          ) : (
                            <span className="text-sm font-semibold text-muted-foreground">{firstLetter(ingestedArtistName)}</span>
                          )}
                        </div>
                        <div className="mt-2 text-xs font-medium truncate">{ingestedArtistName}</div>
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
