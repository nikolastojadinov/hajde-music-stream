import { FormEvent, useEffect, useRef, useState } from "react";
import { Loader2, Play, Search as SearchIcon } from "lucide-react";
import { useNavigate, useSearchParams } from "react-router-dom";
import SearchSuggestList from "@/components/search/SearchSuggestList";
import { Input } from "@/components/ui/input";
import { usePlayer } from "@/contexts/PlayerContext";
import {
  ingestSearchSelection,
  searchResolve,
  searchSuggest,
  type RawSearchItem,
  type SearchSuggestItem,
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
  raw: any;
};

const normalizeString = (value: unknown): string => (typeof value === "string" ? value.trim() : "");

const pickRunsText = (runs: any): string => {
  if (!Array.isArray(runs) || runs.length === 0) return "";
  return normalizeString(runs.map((r: any) => r?.text ?? "").join(""));
};

const pickThumbnail = (thumbnails?: any): string | null => {
  const arr = Array.isArray(thumbnails) ? thumbnails : thumbnails?.thumbnails;
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

const extractEndpoint = (renderer: any): { endpointType?: "watch" | "browse"; payload?: string } => {
  const navigation =
    renderer?.navigationEndpoint ||
    renderer?.playNavigationEndpoint ||
    renderer?.overlay?.musicItemThumbnailOverlayRenderer?.content?.musicPlayButtonRenderer?.playNavigationEndpoint ||
    renderer?.menu?.navigationItemRenderer?.navigationEndpoint ||
    renderer?.onTap?.watchEndpoint ||
    renderer?.onTap?.browseEndpoint;

  const browse = navigation?.browseEndpoint || renderer?.browseEndpoint;
  const watch = navigation?.watchEndpoint || renderer?.watchEndpoint;

  const browseId = normalizeString(browse?.browseId);
  const videoId = normalizeString(watch?.videoId);

  if (videoId) return { endpointType: "watch", payload: videoId };
  if (browseId) return { endpointType: "browse", payload: browseId };
  return {};
};

const splitArtists = (value?: string | null): string[] => {
  if (!value) return [];
  const tokens = value.split(/[·,/|]/g).map((part) => part.trim()).filter(Boolean);
  return tokens.length > 0 ? tokens : [value.trim()].filter(Boolean);
};

const ALLOWED_RENDERERS = new Set([
  "musicResponsiveListItemRenderer",
  "musicCardShelfRenderer",
  "musicShelfRenderer",
  "musicThumbnailRenderer",
  "musicItemThumbnailOverlayRenderer",
]);

const buildDisplayItems = (rawItems: RawSearchItem[]): DisplayResultItem[] => {
  const items: DisplayResultItem[] = [];

  (rawItems || []).forEach((entry, index) => {
    const data = entry?.data ?? {};
    const type = normalizeString(entry?.rendererType) || "item";

    if (!ALLOWED_RENDERERS.has(type)) return;

    let title = "";
    let subtitle = "";
    let imageUrl: string | null = null;
    let endpointType: "watch" | "browse" | undefined;
    let endpointPayload: string | undefined;

    if (type === "musicResponsiveListItemRenderer") {
      title = pickRunsText(data?.flexColumns?.[0]?.musicResponsiveListItemFlexColumnRenderer?.text?.runs) || title;
      subtitle = pickRunsText(data?.flexColumns?.[1]?.musicResponsiveListItemFlexColumnRenderer?.text?.runs) || subtitle;
      imageUrl =
        pickThumbnail(data?.thumbnail?.musicThumbnailRenderer?.thumbnail?.thumbnails) ||
        pickThumbnail(data?.thumbnail?.thumbnails) ||
        null;
      const endpoint = extractEndpoint(data);
      endpointType = endpoint.endpointType;
      endpointPayload = endpoint.payload;
    } else if (type === "musicCardShelfRenderer") {
      title = pickRunsText(data?.title?.runs) || pickRunsText(data?.header?.title?.runs) || title;
      subtitle =
        pickRunsText(data?.subtitle?.runs) ||
        pickRunsText(data?.header?.subtitle?.runs) ||
        subtitle ||
        "Artist";
      imageUrl =
        pickThumbnail(data?.thumbnail?.musicThumbnailRenderer?.thumbnail?.thumbnails) ||
        pickThumbnail(data?.thumbnail?.thumbnails) ||
        null;
      const endpoint = extractEndpoint(data);
      endpointType = endpoint.endpointType;
      endpointPayload = endpoint.payload;
    } else if (type === "musicShelfRenderer") {
      title = pickRunsText(data?.title?.runs) || type;
      subtitle = pickRunsText(data?.subtitle?.runs) || subtitle || "Shelf";
      imageUrl = pickThumbnail(data?.thumbnail?.thumbnails) || imageUrl;
      const endpoint = extractEndpoint(data);
      endpointType = endpoint.endpointType;
      endpointPayload = endpoint.payload;
    } else if (type === "musicThumbnailRenderer") {
      title = pickRunsText(data?.title?.runs) || type;
      subtitle = pickRunsText(data?.subtitle?.runs) || subtitle;
      imageUrl =
        pickThumbnail(data?.thumbnail?.thumbnails) ||
        pickThumbnail(data?.thumbnail?.musicThumbnailRenderer?.thumbnail?.thumbnails) ||
        null;
      const endpoint = extractEndpoint(data);
      endpointType = endpoint.endpointType;
      endpointPayload = endpoint.payload;
    } else if (type === "musicItemThumbnailOverlayRenderer") {
      title = pickRunsText(data?.content?.musicPlayButtonRenderer?.playNavigationEndpoint?.watchEndpoint?.title?.runs) || type;
      subtitle = pickRunsText(data?.subtitle?.runs) || subtitle;
      imageUrl = pickThumbnail(data?.content?.musicPlayButtonRenderer?.thumbnail?.thumbnails) || null;
      const endpoint = extractEndpoint(data);
      endpointType = endpoint.endpointType;
      endpointPayload = endpoint.payload;
    }

    const id = endpointPayload || `raw-${index}`;

    items.push({
      id,
      title: title || type || `Item ${index + 1}`,
      subtitle: subtitle || undefined,
      imageUrl,
      rendererType: type,
      endpointType,
      endpointPayload,
      raw: data,
    } satisfies DisplayResultItem);
  });

  return items;
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

  const suggestAbort = useRef<AbortController | null>(null);
  const suggestTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

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
    clearSuggestions();
    void runSearch(query);
  };

  useEffect(() => {
    if ((query ?? "").trim().length >= 2 && !submitted) {
      void runSearch(query);
    }
  }, []);

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

  const renderResults = () => {
    if (results.length === 0) return null;

    return (
      <section className="mt-6 space-y-3">
        <div className="text-sm font-semibold text-white">Results</div>
        <div className="space-y-3">
          {results.map((item, idx) => (
            <div
              key={`${item.id}-${idx}`}
              className="flex items-center gap-4 rounded-2xl border border-white/5 bg-neutral-900/70 p-3"
            >
              <div className="h-16 w-16 overflow-hidden rounded-xl bg-neutral-800">
                {item.imageUrl ? <img src={item.imageUrl} alt={item.title} className="h-full w-full object-cover" loading="lazy" /> : null}
              </div>

              <div className="flex-1 space-y-1">
                <div className="text-xs uppercase tracking-wide text-neutral-400">{item.rendererType}</div>
                <div className="text-base font-semibold text-white">{item.title}</div>
                {item.subtitle ? <div className="text-sm text-neutral-400">{item.subtitle}</div> : null}
                {item.endpointPayload ? (
                  <div className="text-[11px] text-neutral-500">
                    {item.endpointType ?? "endpoint"}: {item.endpointPayload}
                  </div>
                ) : null}
              </div>

              {item.endpointType === "watch" && item.endpointPayload?.length === 11 ? (
                <button
                  type="button"
                  onClick={() => handlePlay(item)}
                  className="inline-flex items-center gap-2 rounded-full border border-white/20 px-3 py-2 text-sm font-semibold text-white transition hover:border-white/40"
                >
                  <Play className="h-4 w-4" />
                  Play
                </button>
              ) : null}
            </div>
          ))}
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
      </div>
    </div>
  );
}
