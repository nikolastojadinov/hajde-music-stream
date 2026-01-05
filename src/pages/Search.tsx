import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import debounce from "lodash.debounce";
import { Disc3, Music, Search as SearchIcon, User, ListMusic, Play } from "lucide-react";

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
  type SearchSuggestItem,
} from "@/lib/api/search";

const MIN_QUERY_CHARS = 2;

function normalizeQuery(value: string): string {
  return value.trim();
}

export default function Search() {
  const navigate = useNavigate();
  const { playTrack } = usePlayer();

  const [query, setQuery] = useState("");
  const [suggestions, setSuggestions] = useState<SearchSuggestItem[]>([]);
  const [suggestOpen, setSuggestOpen] = useState(false);
  const [suggestLoading, setSuggestLoading] = useState(false);
  const [suggestError, setSuggestError] = useState<string | null>(null);

  const [results, setResults] = useState<SearchResolveResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const inputRef = useRef<HTMLInputElement | null>(null);
  const suggestAbortRef = useRef<AbortController | null>(null);

  const normalizedQuery = useMemo(() => normalizeQuery(query), [query]);
  const normalizedLength = normalizedQuery.length;

  const debouncedSuggest = useMemo(
    () =>
      debounce((q: string) => {
        suggestAbortRef.current?.abort();
        const controller = new AbortController();
        suggestAbortRef.current = controller;
        setSuggestLoading(true);
        setSuggestError(null);
        void (async () => {
          try {
            const resp = await searchSuggest(q, { signal: controller.signal });
            if (!controller.signal.aborted) setSuggestions(resp.suggestions ?? []);
          } catch (e: any) {
            if (controller.signal.aborted) return;
            setSuggestError(e?.message || "Suggest failed");
            setSuggestions([]);
          } finally {
            if (!controller.signal.aborted) setSuggestLoading(false);
          }
        })();
      }, 250),
    []
  );

  useEffect(() => {
    return () => {
      debouncedSuggest.cancel();
      suggestAbortRef.current?.abort();
    };
  }, [debouncedSuggest]);

  useEffect(() => {
    if (normalizedLength < MIN_QUERY_CHARS) {
      debouncedSuggest.cancel();
      suggestAbortRef.current?.abort();
      setSuggestions([]);
      setSuggestLoading(false);
      return;
    }
    debouncedSuggest(normalizedQuery);
  }, [normalizedLength, normalizedQuery, debouncedSuggest]);

  const handleSearch = async (value?: string) => {
    const q = normalizeQuery(value ?? query);
    if (q.length < MIN_QUERY_CHARS) return;

    setLoading(true);
    setError(null);
    setSuggestOpen(false);

    try {
      const resp = await searchResolve({ q });
      setResults(resp);
    } catch (e: any) {
      setError(e?.message || "Search failed");
      setResults(null);
    } finally {
      setLoading(false);
    }
  };

  const handleSuggestionClick = (item: SearchSuggestItem) => {
    setQuery(item.name);
    setSuggestOpen(false);
    if (item.type === "artist") {
      navigate(`/artist/${encodeURIComponent(item.name)}`);
      return;
    }
    void handleSearch(item.name);
  };

  const handlePlay = (youtubeId: string, title: string, artist: string) => {
    playTrack(youtubeId, title, artist, youtubeId);
  };

  const showDropdown = suggestOpen && (suggestions.length > 0 || suggestLoading || suggestError);

  return (
    <div className="space-y-6 p-4 pb-24">
      <div className="rounded-lg border bg-card p-4 shadow-sm">
        <div className="mb-2 flex items-center gap-2 text-muted-foreground">
          <SearchIcon className="h-5 w-5" />
          <span className="text-sm font-semibold">Live search</span>
        </div>
        <div className="relative flex gap-2">
          <Input
            ref={inputRef}
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setSuggestOpen(true);
            }}
            onFocus={() => setSuggestOpen(true)}
            placeholder="Search songs, artists, albums"
          />
          <Button onClick={() => handleSearch()} disabled={normalizedLength < MIN_QUERY_CHARS}>
            Search
          </Button>
          {showDropdown ? (
            <div className="absolute left-0 top-full z-20 mt-1 w-full rounded-md border bg-card shadow-lg">
              {suggestLoading ? (
                <div className="p-3 text-sm text-muted-foreground">Loading…</div>
              ) : suggestError ? (
                <div className="p-3 text-sm text-red-500">{suggestError}</div>
              ) : suggestions.length === 0 ? (
                <div className="p-3 text-sm text-muted-foreground">No suggestions</div>
              ) : (
                <ul className="divide-y">
                  {suggestions.map((s) => (
                    <li
                      key={`${s.type}:${s.id}`}
                      className="flex cursor-pointer items-center gap-3 px-3 py-2 hover:bg-accent"
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => handleSuggestionClick(s)}
                    >
                      <span className="flex h-8 w-8 items-center justify-center rounded bg-muted text-xs font-semibold uppercase">
                        {s.type === "artist" && <User className="h-4 w-4" />}
                        {s.type === "track" && <Music className="h-4 w-4" />}
                        {s.type === "album" && <Disc3 className="h-4 w-4" />}
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium">{s.name}</p>
                        {s.subtitle ? <p className="truncate text-xs text-muted-foreground">{s.subtitle}</p> : null}
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          ) : null}
        </div>
      </div>

      {loading ? (
        <LoadingSkeleton />
      ) : error ? (
        <ErrorState title="Search failed" subtitle={error} onRetry={() => handleSearch()} />
      ) : results ? (
        <div className="space-y-8">
          <section>
            <div className="mb-3 flex items-center gap-2">
              <Music className="h-5 w-5" />
              <h2 className="text-lg font-semibold">Songs</h2>
            </div>
            {results.tracks.length === 0 ? (
              <EmptyState title="No songs" subtitle="Try another query." />
            ) : (
              <div className="space-y-2">
                {results.tracks.map((t) => (
                  <div key={t.id} className="flex items-center justify-between rounded-md border p-3">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold">{t.title}</p>
                      <p className="truncate text-xs text-muted-foreground">{t.artist}</p>
                    </div>
                    <Button variant="ghost" size="icon" onClick={() => handlePlay(t.youtubeId, t.title, t.artist)}>
                      <Play className="h-4 w-4" />
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </section>

          <section>
            <div className="mb-3 flex items-center gap-2">
              <User className="h-5 w-5" />
              <h2 className="text-lg font-semibold">Artists</h2>
            </div>
            {results.artists.length === 0 ? (
              <EmptyState title="No artists" subtitle="Try another query." />
            ) : (
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
                {results.artists.map((a) => (
                  <Link
                    key={a.id}
                    to={`/artist/${encodeURIComponent(a.name)}`}
                    className="flex items-center gap-3 rounded-md border p-3 hover:bg-accent"
                  >
                    <div className="flex h-10 w-10 items-center justify-center rounded-full bg-muted text-sm font-semibold">
                      {a.name.slice(0, 1).toUpperCase()}
                    </div>
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold">{a.name}</p>
                      <p className="truncate text-xs text-muted-foreground">YouTube • Live</p>
                    </div>
                  </Link>
                ))}
              </div>
            )}
          </section>

          <section>
            <div className="mb-3 flex items-center gap-2">
              <ListMusic className="h-5 w-5" />
              <h2 className="text-lg font-semibold">Albums</h2>
            </div>
            {results.albums.length === 0 ? (
              <EmptyState title="No albums" subtitle="Try another query." />
            ) : (
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
                {results.albums.map((p) => (
                  <a
                    key={p.id}
                    href={`https://music.youtube.com/playlist?list=${encodeURIComponent(p.id)}`}
                    target="_blank"
                    rel="noreferrer"
                    className="flex flex-col gap-2 rounded-md border p-3 hover:bg-accent"
                  >
                    <div className="flex h-24 w-full items-center justify-center rounded bg-muted text-xs font-semibold text-muted-foreground">
                      {p.title.slice(0, 1).toUpperCase()}
                    </div>
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold">{p.title}</p>
                      <p className="truncate text-xs text-muted-foreground">{p.channelTitle || "YouTube Music"}</p>
                    </div>
                  </a>
                ))}
              </div>
            )}
          </section>
        </div>
      ) : (
        <EmptyState title="Search music live" subtitle="Start typing to see suggestions." />
      )}
    </div>
  );
}
