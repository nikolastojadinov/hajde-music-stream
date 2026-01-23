// target file: src/pages/Search.tsx

import { FormEvent, useEffect, useRef, useState } from "react";
import { Clock3, Loader2, Music2, Search as SearchIcon, UserRound, Vinyl } from "lucide-react";
import { useNavigate, useSearchParams } from "react-router-dom";
import SearchSuggestList from "@/components/search/SearchSuggestList";
import { Input } from "@/components/ui/input";
import { usePlayer } from "@/contexts/PlayerContext";
import {
  ingestSearchSelection,
  fetchSearchHistory,
  searchResolve,
  searchSuggest,
  type RawSearchItem,
  type SearchSuggestItem,
  type SearchHistoryItem,
} from "@/lib/api/search";

const SUGGEST_DEBOUNCE_MS = 250;
const MAX_SUGGESTIONS = 15;

type DisplayResultItem = {
  id: string;
  title: string;
  subtitle?: string;
  imageUrl?: string | null;
  rendererType: string;
  endpointType?: "watch" | "browse";
  endpointPayload?: string;
  browsePageType?: string;
  browseId?: string | null;
  raw: unknown;
};

const normalizeString = (value: unknown): string => (typeof value === "string" ? value.trim() : "");

const pickRunsText = (runs: unknown): string => {
  if (!Array.isArray(runs) || runs.length === 0) return "";
  return normalizeString((runs as Array<{ text?: string }>).map((r) => r?.text ?? "").join(""));
};

const pickThumbnail = (thumbnails?: unknown): string | null => {
  const arr = Array.isArray(thumbnails) ? thumbnails : (thumbnails as any)?.thumbnails;
  if (!Array.isArray(arr) || arr.length === 0) return null;

  const scored = arr
    .map((t: any) => {
      const url = normalizeString(t?.url);
      const width = Number(t?.width) || 0;
      const height = Number(t?.height) || 0;
      const area = width > 0 && height > 0 ? width * height : width || height;
      return url ? { url, score: area } : null;
    })
    .filter(Boolean) as Array<{ url: string; score: number }>;

  if (scored.length === 0) return null;
  scored.sort((a, b) => b.score - a.score);
  return scored[0].url;
};

const extractEndpoint = (
  renderer: any
): { endpointType?: "watch" | "browse"; payload?: string; browsePageType?: string } => {
  const navigation =
    renderer?.navigationEndpoint ||
    renderer?.playNavigationEndpoint ||
    renderer?.overlay?.musicItemThumbnailOverlayRenderer?.content?.musicPlayButtonRenderer?.playNavigationEndpoint ||
    renderer?.menu?.navigationItemRenderer?.navigationEndpoint ||
    renderer?.onTap?.watchEndpoint ||
    renderer?.onTap?.browseEndpoint;

  const browse = navigation?.browseEndpoint || renderer?.browseEndpoint;
  const watch = navigation?.watchEndpoint || renderer?.watchEndpoint;

  const browsePageType =
    browse?.browseEndpointContextSupportedConfigs?.browseEndpointContextMusicConfig?.pageType ||
    renderer?.browseEndpointContextSupportedConfigs?.browseEndpointContextMusicConfig?.pageType;

  const browseId = normalizeString(browse?.browseId);
  const videoId = normalizeString(watch?.videoId);

  if (videoId) return { endpointType: "watch", payload: videoId, browsePageType };
  if (browseId) return { endpointType: "browse", payload: browseId, browsePageType };
  return {};
};

const pickBrowseId = (renderer: any, fallback?: string): string | null => {
  const runs: Array<{ navigationEndpoint?: { browseEndpoint?: { browseId?: string } } } | undefined> =
    (renderer?.title?.runs as Array<{ navigationEndpoint?: { browseEndpoint?: { browseId?: string } } }> | undefined) ||
    (renderer?.header?.title?.runs as Array<{ navigationEndpoint?: { browseEndpoint?: { browseId?: string } } }> | undefined) ||
    (renderer?.subtitle?.runs as Array<{ navigationEndpoint?: { browseEndpoint?: { browseId?: string } } }> | undefined) ||
    (renderer?.header?.subtitle?.runs as Array<{ navigationEndpoint?: { browseEndpoint?: { browseId?: string } } }> | undefined) ||
    [];

  const runBrowseId = runs.find((r) => r?.navigationEndpoint?.browseEndpoint?.browseId)?.navigationEndpoint?.browseEndpoint?.browseId;

  const candidates = [
    renderer?.browseId,
    renderer?.navigationEndpoint?.browseEndpoint?.browseId,
    renderer?.browseEndpoint?.browseId,
    renderer?.onTap?.browseEndpoint?.browseId,
    renderer?.menu?.navigationItemRenderer?.navigationEndpoint?.browseEndpoint?.browseId,
    renderer?.header?.navigationEndpoint?.browseEndpoint?.browseId,
    runBrowseId,
    fallback,
  ];

  const picked = candidates.map(normalizeString).find(Boolean);
  return picked || null;
};

const splitArtists = (value?: string | null): string[] => {
  if (!value) return [];
  const tokens = value.split(/[·,/|]/g).map((part) => part.trim()).filter(Boolean);
  return tokens.length > 0 ? tokens : [value.trim()].filter(Boolean);
};

const ALLOWED_RENDERERS = new Set(["musicResponsiveListItemRenderer", "musicCardShelfRenderer"]);

const buildDisplayItems = (rawItems: RawSearchItem[]): DisplayResultItem[] => {
  const items: DisplayResultItem[] = [];

  (rawItems || []).forEach((entry, index) => {
    const data = entry?.data ?? {};
    const type = normalizeString(entry?.rendererType) || "item";

    if (!ALLOWED_RENDERERS.has(type)) return;
    if (type === "musicCardShelfRenderer" && items.length > 0) return;

    let title = "";
    let subtitle = "";
    let imageUrl: string | null = null;
    let endpointType: "watch" | "browse" | undefined;
    let endpointPayload: string | undefined;
    let browsePageType: string | undefined;
    let browseId: string | null = null;

    if (type === "musicResponsiveListItemRenderer") {
      title = pickRunsText((data as any)?.flexColumns?.[0]?.musicResponsiveListItemFlexColumnRenderer?.text?.runs) || title;
      subtitle = pickRunsText((data as any)?.flexColumns?.[1]?.musicResponsiveListItemFlexColumnRenderer?.text?.runs) || subtitle;
      imageUrl =
        pickThumbnail((data as any)?.thumbnail?.musicThumbnailRenderer?.thumbnail?.thumbnails) ||
        pickThumbnail((data as any)?.thumbnail?.thumbnails) ||
        null;
      const endpoint = extractEndpoint(data);
      endpointType = endpoint.endpointType;
      endpointPayload = endpoint.payload;
      browsePageType = endpoint.browsePageType;
      browseId = pickBrowseId(data, endpoint.endpointType === "browse" ? endpoint.payload : undefined);
    } else if (type === "musicCardShelfRenderer") {
      title = pickRunsText((data as any)?.title?.runs) || pickRunsText((data as any)?.header?.title?.runs) || title;
      subtitle =
        pickRunsText((data as any)?.subtitle?.runs) ||
        pickRunsText((data as any)?.header?.subtitle?.runs) ||
        subtitle ||
        "Artist";
      imageUrl =
        pickThumbnail((data as any)?.thumbnail?.musicThumbnailRenderer?.thumbnail?.thumbnails) ||
        pickThumbnail((data as any)?.thumbnail?.thumbnails) ||
        null;
      const endpoint = extractEndpoint(data);
      endpointType = endpoint.endpointType;
      endpointPayload = endpoint.payload;
      browsePageType = endpoint.browsePageType;
      browseId = pickBrowseId(data, endpoint.endpointType === "browse" ? endpoint.payload : undefined);
    }

    if (!endpointType && endpointPayload && /^UC[A-Za-z0-9_-]+$/i.test(endpointPayload)) {
      endpointType = "browse";
      browsePageType = browsePageType || "MUSIC_PAGE_TYPE_ARTIST";
    }

    if (!endpointType && browseId) {
      endpointType = "browse";
      endpointPayload = browseId;
    }

    if (!browseId && endpointType === "browse" && endpointPayload) {
      browseId = normalizeString(endpointPayload);
    }

    const id = endpointPayload || browseId || `raw-${index}`;

    items.push({
      id,
      title: title || type || `Item ${index + 1}`,
      subtitle: subtitle || undefined,
      imageUrl,
      rendererType: type,
      endpointType,
      endpointPayload,
      browsePageType,
      browseId,
      raw: data,
    });
  });

  return items;
};

const getArtistBrowseId = (item: DisplayResultItem): string | null => {
  const candidate = normalizeString(item.browseId) || normalizeString(item.endpointPayload) || normalizeString(item.id);
  return candidate || null;
};

const isArtistResult = (item: DisplayResultItem): boolean => {
  const browseId = getArtistBrowseId(item);
  const pageType = normalizeString(item.browsePageType).toUpperCase();
  const subtitle = normalizeString(item.subtitle).toLowerCase();

  if (!browseId) return false;
  if (pageType === "MUSIC_PAGE_TYPE_ARTIST") return true;
  if (/^UC[A-Za-z0-9_-]+$/i.test(browseId)) return true;
  if (subtitle.includes("artist")) return true;
  return false;
};

export default function Search() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const { playTrack } = usePlayer();

  const [query, setQuery] = useState(() => searchParams.get("q") ?? "");
  const [results, setResults] = useState<DisplayResultItem[]>([]);
  const [suggestions, setSuggestions] = useState<SearchSuggestItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastSearched, setLastSearched] = useState("");
  const [historyItems, setHistoryItems] = useState<SearchHistoryItem[]>([]);
  const [historyError, setHistoryError] = useState<string | null>(null);

  const suggestAbort = useRef<AbortController | null>(null);
  const suggestTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const loadHistory = async () => {
    try {
      const res = await fetchSearchHistory();
      setHistoryItems(res.items || []);
      setHistoryError(null);
    } catch {
      setHistoryError("Unable to load recent activity.");
      setHistoryItems([]);
    }
  };

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
    void loadHistory();
  }, []);

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
        setSuggestions(Array.isArray(res?.suggestions) ? res.suggestions.slice(0, MAX_SUGGESTIONS) : []);
      } catch {
        /* ignore suggest errors */
      }
    }, SUGGEST_DEBOUNCE_MS);
  };

  const runSearch = async (value: string) => {
    const q = value.trim();
    if (q.length < 2) return;

    setLoading(true);
    setError(null);
    setSubmitted(true);
    setLastSearched(q);

    try {
      const res = await searchResolve({ q });
      const displayItems = buildDisplayItems(res?.rawItems ?? []);
      setResults(displayItems);
      const next = new URLSearchParams(searchParams);
      next.set("q", q);
      setSearchParams(next);
    } catch {
      setError("Unable to load search results.");
      setResults([]);
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    inputRef.current?.blur();
    clearSuggestions();
    void runSearch(query);
  };

  useEffect(() => {
    if ((query ?? "").trim().length >= 2 && !submitted) {
      void runSearch(query);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleHistorySelect = (item: SearchHistoryItem) => {
    const entityId = normalizeString(item.entityId);
    if (!entityId) return;

    if (item.entityType === "artist") {
      navigate(`/artist/${encodeURIComponent(entityId)}`);
      return;
    }

    if (item.entityType === "album" || item.entityType === "playlist") {
      navigate(`/playlist/${encodeURIComponent(entityId)}`);
      return;
    }

    if (item.entityType === "search") {
      setQuery(entityId);
      void runSearch(entityId);
      return;
    }
  };

  const renderHistory = () => {
    if (submitted || query.trim().length > 1) return null;
    if (historyItems.length === 0) {
      if (historyError) {
        return <div className="mt-6 text-sm text-red-200/80">{historyError}</div>;
      }
      return null;
    }

    const iconFor = (type: SearchHistoryItem["entityType"]) => {
      if (type === "artist") return <UserRound className="h-4 w-4" />;
      if (type === "album") return <Vinyl className="h-4 w-4" />;
      if (type === "playlist") return <Music2 className="h-4 w-4" />;
      return <SearchIcon className="h-4 w-4" />;
    };

    return (
      <section className="mt-6 space-y-3">
        <div className="flex items-center gap-2 text-sm font-semibold text-white">
          <Clock3 className="h-4 w-4" />
          Recent activity
        </div>
        <div className="divide-y divide-white/5 rounded-xl border border-white/5">
          {historyItems.map((item) => {
            const label = item.entityId;
            const typeLabel = item.entityType.charAt(0).toUpperCase() + item.entityType.slice(1);
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => handleHistorySelect(item)}
                className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-white/5"
              >
                <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-white/5 text-white/80">
                  {iconFor(item.entityType)}
                </span>
                <div className="flex min-w-0 flex-col">
                  <span className="truncate text-sm font-semibold text-white">{label}</span>
                  <span className="text-xs text-neutral-400">{typeLabel}</span>
                </div>
              </button>
            );
          })}
        </div>
      </section>
    );
  };

  const handlePlay = (item: DisplayResultItem) => {
    const id = normalizeString(item.endpointPayload);
    if (!id || item.endpointType !== "watch" || id.length !== 11) return;

    void ingestSearchSelection({
      type: "song",
      id,
      title: item.title,
      subtitle: item.subtitle,
      imageUrl: item.imageUrl ?? undefined,
    });

    playTrack(
      {
        youtubeVideoId: id,
        title: item.title,
        artist: splitArtists(item.subtitle)?.[0] || item.subtitle || item.title,
        thumbnailUrl: item.imageUrl ?? undefined,
      },
      "song"
    );
  };

  const handleArtistNavigate = (item: DisplayResultItem) => {
    const browseId = getArtistBrowseId(item);
    if (!browseId) {
      console.warn("search: artist result missing browseId", item);
      return;
    }

    void ingestSearchSelection({
      type: "artist",
      id: browseId,
      title: item.title,
      subtitle: item.subtitle,
      imageUrl: item.imageUrl ?? undefined,
    });

    navigate(`/artist/${encodeURIComponent(browseId)}`);
  };

  const handleSuggestionSelect = (item: SearchSuggestItem) => {
    clearSuggestions();

    if (item.type === "track") {
      const id = item.id.trim();
      if (id.length === 11) {
        void ingestSearchSelection({ type: "song", id, title: item.name, subtitle: item.subtitle, imageUrl: item.imageUrl });
        playTrack(
          {
            youtubeVideoId: id,
            title: item.name,
            artist: item.subtitle || item.name,
            thumbnailUrl: item.imageUrl,
          },
          "song"
        );
        return;
      }
    }

    if (item.type === "artist") {
      void ingestSearchSelection({ type: "artist", id: item.id, title: item.name, subtitle: item.subtitle, imageUrl: item.imageUrl });
      navigate(`/artist/${encodeURIComponent(item.id)}`);
      return;
    }

    if (item.type === "album" || item.type === "playlist") {
      void ingestSearchSelection({ type: item.type, id: item.id, title: item.name, subtitle: item.subtitle, imageUrl: item.imageUrl });
      navigate(`/playlist/${encodeURIComponent(item.id)}`, {
        state: { playlistId: item.id, playlistTitle: item.name, playlistCover: item.imageUrl ?? null },
      });
      return;
    }

    setQuery(item.name);
    void runSearch(item.name);
  };

  const handleResultSelect = (item: DisplayResultItem) => {
    if (isArtistResult(item)) {
      handleArtistNavigate(item);
      return;
    }

    if (item.endpointType === "watch" && item.endpointPayload?.length === 11) {
      handlePlay(item);
      return;
    }

    if (item.endpointType === "browse" && item.endpointPayload) {
      navigate(`/playlist/${encodeURIComponent(item.endpointPayload)}`, {
        state: {
          playlistId: item.endpointPayload,
          playlistTitle: item.title,
          playlistCover: item.imageUrl ?? null,
        },
      });
    }
  };

  const renderResults = () => {
    if (results.length === 0) return null;

    return (
      <section className="mt-6 space-y-3">
        <div className="text-sm font-semibold text-white">Results</div>
        <div className="divide-y divide-white/5">
          {results.map((item, idx) => {
            const artistResult = isArtistResult(item);
            const clickable = artistResult || item.endpointType === "watch" || item.endpointType === "browse";
            return (
              <div
                key={`${item.id}-${idx}`}
                className={`flex items-center gap-3 py-3 ${clickable ? "cursor-pointer hover:bg-white/5" : ""}`}
                onClick={clickable ? () => handleResultSelect(item) : undefined}
              >
                <div className="h-12 w-12 overflow-hidden rounded-lg bg-neutral-800 flex-shrink-0">
                  {item.imageUrl ? <img src={item.imageUrl} alt={item.title} className="h-full w-full object-cover" loading="lazy" /> : null}
                </div>

                <div className="flex-1 space-y-1 overflow-hidden">
                  <div className="text-base font-semibold text-white truncate" title={item.title}>
                    {item.title}
                  </div>
                  {item.subtitle ? <div className="text-sm text-neutral-400">{item.subtitle}</div> : null}
                </div>
              </div>
            );
          })}
        </div>
      </section>
    );
  };

  return (
    <div className="min-h-screen bg-neutral-950 text-white">
      <div className="mx-auto max-w-5xl px-4 pb-28 pt-6">
        <form onSubmit={handleSubmit} className="sticky top-0 z-40 bg-neutral-950/90 pb-3 backdrop-blur">
          <div className="relative">
            <Input
              ref={inputRef}
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                scheduleSuggest(e.target.value);
              }}
              placeholder="Search songs, artists, albums"
              className="h-12 rounded-full border border-white/5 bg-neutral-900 pl-4 pr-11 text-sm text-white"
            />
            <SearchIcon className="pointer-events-none absolute right-4 top-1/2 h-5 w-5 -translate-y-1/2 text-neutral-500" />
          </div>

          {suggestions.length > 0 && (
            <div className="mt-2 overflow-hidden rounded-2xl border border-white/5 bg-neutral-900/95 shadow-xl">
              <SearchSuggestList suggestions={suggestions} onSelect={handleSuggestionSelect} />
            </div>
          )}
        </form>

        {loading ? (
          <div className="mt-10 flex items-center gap-3 text-sm text-neutral-400">
            <Loader2 className="h-5 w-5 animate-spin" />
            Loading results…
          </div>
        ) : null}

        {error ? (
          <div className="mt-6 rounded-xl border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm text-red-100">
            {error}
          </div>
        ) : null}

        {!loading && submitted && !error && results.length === 0 ? (
          <div className="mt-10 text-sm text-neutral-400">No results for “{lastSearched}”. Try another search.</div>
        ) : null}

        {renderResults()}
        {renderHistory()}
      </div>
    </div>
  );
}
