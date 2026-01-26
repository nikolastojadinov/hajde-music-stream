import { FormEvent, ReactNode, useEffect, useRef, useState } from "react";
import { Clock3, Loader2, Music2, Search as SearchIcon, Sparkles, UserRound } from "lucide-react";
import { useNavigate } from "react-router-dom";

import { Input } from "@/components/ui/input";
import { usePlayer } from "@/contexts/PlayerContext";
import { useActivityLogger } from "@/hooks/useActivityLogger";
import {
  fetchLocalActivity,
  fetchLocalRecentQueries,
  fetchLocalSuggest,
  postLocalRecentSearch,
  type LocalActivityItem,
  type LocalRecentQuery,
  type LocalSuggestItem,
} from "@/lib/api/localSearch";

const SUGGEST_DEBOUNCE_MS = 220;
const LIST_LIMIT = 15;

const normalize = (value: unknown): string => (typeof value === "string" ? value.trim() : "");

const dedupeByKey = <T,>(items: T[], key: (item: T) => string, limit = LIST_LIMIT): T[] => {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const item of items) {
    const k = key(item);
    if (!k || seen.has(k)) continue;
    seen.add(k);
    out.push(item);
    if (out.length >= limit) break;
  }
  return out;
};

const iconForType = (type: string) => {
  const t = type.toLowerCase();
  if (t === "artist") return <UserRound className="h-4 w-4" />;
  if (t === "album" || t === "playlist") return <Music2 className="h-4 w-4" />;
  if (t === "track" || t === "song") return <Sparkles className="h-4 w-4" />;
  return <SearchIcon className="h-4 w-4" />;
};

const Thumb = ({ imageUrl, fallback }: { imageUrl: string | null | undefined; fallback: ReactNode }) => {
  if (imageUrl) {
    return <img src={imageUrl} alt="" className="h-9 w-9 rounded-full object-cover" />;
  }
  return (
    <span className="flex h-9 w-9 items-center justify-center rounded-full bg-white/5 text-white/80">
      {fallback}
    </span>
  );
};

export default function Search() {
  const navigate = useNavigate();
  const { playTrack } = usePlayer();
  const { logActivity } = useActivityLogger();

  const [query, setQuery] = useState("");
  const [suggestions, setSuggestions] = useState<LocalSuggestItem[]>([]);
  const [activity, setActivity] = useState<LocalActivityItem[]>([]);
  const [recentQueries, setRecentQueries] = useState<LocalRecentQuery[]>([]);
  const [loadingInitial, setLoadingInitial] = useState(true);
  const [loadingSuggest, setLoadingSuggest] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const inputRef = useRef<HTMLInputElement | null>(null);
  const suggestTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    let active = true;
    inputRef.current?.focus();
    (async () => {
      try {
        const [act, recent] = await Promise.all([fetchLocalActivity(LIST_LIMIT), fetchLocalRecentQueries(LIST_LIMIT)]);
        if (!active) return;
        setActivity(act);
        setRecentQueries(recent);
      } catch (err: any) {
        if (!active) return;
        setError("Unable to load your recent activity.");
        console.error("[search] bootstrap_failed", err?.message || err);
      } finally {
        if (active) setLoadingInitial(false);
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  const scheduleSuggest = (value: string) => {
    const q = value.trim();
    if (suggestTimer.current) clearTimeout(suggestTimer.current);
    if (!q) {
      setSuggestions([]);
      return;
    }

    suggestTimer.current = setTimeout(async () => {
      setLoadingSuggest(true);
      try {
        const next = await fetchLocalSuggest(q, LIST_LIMIT);
        setSuggestions(next);
      } catch (err: any) {
        console.error("[search] suggest_failed", err?.message || err);
      } finally {
        setLoadingSuggest(false);
      }
    }, SUGGEST_DEBOUNCE_MS);
  };

  const upsertActivity = (item: LocalActivityItem) => {
    setActivity((prev) => dedupeByKey([item, ...prev], (it) => `${normalize(it.entityType)}|${normalize(it.entityId)}`));
  };

  const upsertRecent = (entry: LocalRecentQuery) => {
    setRecentQueries((prev) => dedupeByKey([entry, ...prev], (it) => normalize(it.query)));
  };

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    const q = query.trim();
    if (!q) return;
    void persistRecentSearch(q);
  };

  const persistRecentSearch = async (q: string) => {
    const now = new Date().toISOString();
    upsertRecent({ query: q, lastUsedAt: now, useCount: 1 });
    await postLocalRecentSearch(q);
  };

  const navigateTo = (type: string, entityId: string, title: string, subtitle?: string | null, imageUrl?: string | null) => {
    const kind = type.toLowerCase();
    const id = normalize(entityId);
    if (!id) return;

    if (kind === "artist") {
      navigate(`/artist/${encodeURIComponent(id)}`);
      return;
    }

    if (kind === "playlist" || kind === "album") {
      navigate(`/playlist/${encodeURIComponent(id)}`,
        {
          state: {
            playlistId: id,
            playlistTitle: title || id,
            playlistCover: imageUrl ?? null,
            artistName: subtitle || "",
          },
        });
      return;
    }

    if (kind === "track" || kind === "song") {
      playTrack({ youtubeVideoId: id, title: title || "Track", artist: subtitle || "" }, "song");
    }
  };

  const handleSuggestionClick = async (s: LocalSuggestItem) => {
    const id = normalize(s.externalId);
    const type = (s.type || "track").toLowerCase();
    if (!id) return;

    const now = new Date().toISOString();
    upsertActivity({
      entityType: type,
      entityId: id,
      title: s.title || id,
      subtitle: s.subtitle ?? null,
      imageUrl: s.imageUrl ?? null,
      externalId: id,
      createdAt: now,
    });

    await logActivity({
      type,
      externalId: id,
      snapshot: {
        title: s.title,
        subtitle: s.subtitle ?? null,
        imageUrl: s.imageUrl ?? null,
      },
    });

    navigateTo(type, id, s.title, s.subtitle, s.imageUrl ?? null);
  };

  const handleActivityClick = (item: LocalActivityItem) => {
    navigateTo(item.entityType, item.entityId, item.title, item.subtitle, item.imageUrl ?? null);
  };

  const renderActivity = () => {
    if (activity.length === 0) return null;
    return (
      <section className="mt-6 space-y-3">
        <div className="flex items-center gap-2 text-sm font-semibold text-white">
          <Clock3 className="h-4 w-4" />
          Recent activity
        </div>
        <div className="divide-y divide-white/5 rounded-xl border border-white/5">
          {activity.map((item) => (
            <button
              key={`${item.entityType}-${item.entityId}`}
              className="flex w-full items-center gap-3 bg-white/0 px-4 py-3 text-left text-sm text-white transition hover:bg-white/5"
              onClick={() => handleActivityClick(item)}
            >
              <Thumb imageUrl={item.imageUrl} fallback={iconForType(item.entityType)} />
              <div className="min-w-0">
                <div className="truncate font-semibold">{item.title}</div>
                <div className="truncate text-xs text-white/60">{item.subtitle || item.entityType}</div>
              </div>
            </button>
          ))}
        </div>
      </section>
    );
  };

  const renderRecentQueries = () => {
    if (recentQueries.length === 0) return null;
    return (
      <section className="mt-6 space-y-3">
        <div className="flex items-center gap-2 text-sm font-semibold text-white">
          <SearchIcon className="h-4 w-4" />
          Recent searches
        </div>
        <div className="flex flex-wrap gap-2">
          {recentQueries.map((item) => (
            <button
              key={item.query}
              className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs text-white transition hover:border-white/30 hover:bg-white/10"
              onClick={() => setQuery(item.query)}
            >
              {item.query}
            </button>
          ))}
        </div>
      </section>
    );
  };

  const renderSuggestions = () => {
    if (!query.trim()) return null;
    if (loadingSuggest) {
      return (
        <div className="mt-4 flex items-center gap-2 text-sm text-white/60">
          <Loader2 className="h-4 w-4 animate-spin" />
          Loading suggestions...
        </div>
      );
    }

    if (suggestions.length === 0) return null;

    return (
      <div className="mt-4 divide-y divide-white/5 rounded-xl border border-white/5">
        {suggestions.map((s, idx) => (
          <button
            key={`${s.type}-${s.externalId || s.title}-${idx}`}
            className="flex w-full items-center gap-3 bg-white/0 px-4 py-3 text-left text-sm text-white transition hover:bg-white/5"
            onClick={() => void handleSuggestionClick(s)}
          >
            <Thumb imageUrl={s.imageUrl} fallback={iconForType(s.type)} />
            <div className="min-w-0">
              <div className="truncate font-semibold">{s.title}</div>
              <div className="truncate text-xs text-white/60">{s.subtitle || s.type}</div>
            </div>
          </button>
        ))}
      </div>
    );
  };

  return (
    <div className="mx-auto mt-6 max-w-4xl px-4 pb-16">
      <h1 className="text-3xl font-semibold text-white">Search</h1>
      <p className="mt-2 text-sm text-white/60">Local-only suggestions and your recent plays—no external calls.</p>

      <form className="mt-6" onSubmit={handleSubmit}>
        <div className="relative">
          <SearchIcon className="pointer-events-none absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-white/40" />
          <Input
            ref={inputRef}
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              scheduleSuggest(e.target.value);
            }}
            placeholder="Artists, tracks, playlists..."
            className="h-12 rounded-2xl border border-white/10 bg-white/5 pl-10 text-base text-white placeholder:text-white/40 focus-visible:border-white/30 focus-visible:ring-0"
          />
        </div>
      </form>

      {loadingInitial && (
        <div className="mt-4 flex items-center gap-2 text-sm text-white/60">
          <Loader2 className="h-4 w-4 animate-spin" />
          Loading your data...
        </div>
      )}

      {error && <div className="mt-4 text-sm text-red-200/80">{error}</div>}

      {renderRecentQueries()}
      {renderSuggestions()}
      {renderActivity()}
    </div>
  );
}
