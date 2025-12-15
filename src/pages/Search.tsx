import { useEffect, useMemo, useRef, useState } from "react";
import { ListMusic, Music, Search as SearchIcon, User } from "lucide-react";
import { Link, useNavigate } from "react-router-dom";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { usePlayer } from "@/contexts/PlayerContext";
import {
  type SearchResolveMode,
  type SearchResolveSpotifySelection,
  type SearchResolveResponse,
  type SearchSuggestResponse,
  searchResolve,
  searchSuggest,
} from "@/lib/api/search";

type SuggestionKind = "artist" | "album" | "track";

type Suggestion = {
  kind: SuggestionKind;
  id: string;
  name: string;
  subtitle?: string;
  imageUrl?: string;
  spotify?: SearchResolveSpotifySelection;
};

type ResolvedArtistChannel = {
  channelId: string;
  title: string;
  thumbnailUrl: string | null;
};

type ResolvedArtistChannelsEnvelope = {
  local: ResolvedArtistChannel[];
  youtube: ResolvedArtistChannel[];
  decision: "local_only" | "youtube_fallback";
};

function normalizeQuery(value: string): string {
  return value.trim();
}

function firstLetter(title: string): string {
  const trimmed = title.trim();
  if (!trimmed) return "?";
  return trimmed[0]?.toUpperCase() ?? "?";
}

function normalizeResolvedArtistChannels(input: any): ResolvedArtistChannelsEnvelope {
  const ac = input?.artist_channels;

  const rawLocal = Array.isArray(ac?.local) ? ac.local : [];
  const rawYoutube = Array.isArray(ac?.youtube) ? ac.youtube : [];
  const decision: "local_only" | "youtube_fallback" = ac?.decision === "youtube_fallback" ? "youtube_fallback" : "local_only";

  const toChannel = (x: any): ResolvedArtistChannel | null => {
    const channelId = typeof x?.channelId === "string" ? x.channelId.trim() : "";
    const title = typeof x?.title === "string" ? x.title.trim() : "";
    const thumbnailUrl = typeof x?.thumbnailUrl === "string" ? x.thumbnailUrl : null;
    if (!channelId || !title) return null;
    return { channelId, title, thumbnailUrl };
  };

  return {
    local: rawLocal.map(toChannel).filter((c): c is ResolvedArtistChannel => Boolean(c)),
    youtube: rawYoutube.map(toChannel).filter((c): c is ResolvedArtistChannel => Boolean(c)),
    decision,
  };
}

export default function Search() {
  const { playTrack } = usePlayer();
  const navigate = useNavigate();

  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");

  const [suggestions, setSuggestions] = useState<SearchSuggestResponse | null>(null);
  const [suggestLoading, setSuggestLoading] = useState(false);

  const [resolved, setResolved] = useState<SearchResolveResponse | null>(null);
  const [resolveLoading, setResolveLoading] = useState(false);

  const [error, setError] = useState<string | null>(null);
  const [suggestOpen, setSuggestOpen] = useState(false);

  const suggestAbortRef = useRef<AbortController | null>(null);
  const resolveAbortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    const t = setTimeout(() => setDebouncedQuery(normalizeQuery(query)), 250);
    return () => clearTimeout(t);
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
        setSuggestions(next);
      } catch (e: any) {
        if (controller.signal.aborted) return;
        setSuggestions(null);
        setError(e?.message || "Search suggest failed");
      } finally {
        if (!controller.signal.aborted) {
          setSuggestLoading(false);
        }
      }
    })();
  }, [debouncedQuery]);

  const flatSuggestions: Suggestion[] = useMemo(() => {
    if (!suggestions) return [];

    const out: Suggestion[] = [];

    for (const a of suggestions.artists || []) {
      out.push({
        kind: "artist",
        id: a.id,
        name: a.name,
        imageUrl: a.imageUrl,
        spotify: { type: "artist", id: a.id, name: a.name },
      });
    }

    for (const al of suggestions.albums || []) {
      out.push({
        kind: "album",
        id: al.id,
        name: al.name,
        subtitle: al.artistName,
        imageUrl: al.imageUrl,
        spotify: {
          type: "album",
          id: al.id,
          name: al.name,
          artistName: al.artistName,
        },
      });
    }

    for (const t of suggestions.tracks || []) {
      out.push({
        kind: "track",
        id: t.id,
        name: t.name,
        subtitle: t.artistName,
        imageUrl: t.imageUrl,
        spotify: {
          type: "track",
          id: t.id,
          name: t.name,
          artistName: t.artistName,
        },
      });
    }

    return out;
  }, [suggestions]);

  const resultsSongs = useMemo(() => {
    const localTracks = resolved?.local?.tracks || [];
    const ytVideos = resolved?.youtube?.videos || [];

    const local = localTracks
      .filter((t) => t.externalId)
      .map((t) => ({
        key: `local:${t.id}`,
        title: t.title,
        artist: t.artist,
        youtubeId: t.externalId as string,
        trackId: t.id,
      }));

    const yt = ytVideos.map((v) => ({
      key: `yt:${v.id}`,
      title: v.title,
      artist: v.channelTitle,
      youtubeId: v.id,
      trackId: null as string | null,
    }));

    return [...local, ...yt];
  }, [resolved]);

  const resultsPlaylists = useMemo(() => {
    const localPlaylists = resolved?.local?.playlists || [];
    const ytPlaylists = resolved?.youtube?.playlists || [];

    return {
      local: localPlaylists,
      youtube: ytPlaylists,
    };
  }, [resolved]);

  const resolvedArtistChannels = useMemo(() => normalizeResolvedArtistChannels(resolved), [resolved]);

  async function runResolve(nextQuery: string, mode: SearchResolveMode, spotify?: SearchResolveSpotifySelection) {
    const q = normalizeQuery(nextQuery);
    if (!q) return;

    resolveAbortRef.current?.abort();
    const controller = new AbortController();
    resolveAbortRef.current = controller;

    setResolveLoading(true);
    setError(null);

    try {
      const payload = { q, mode, spotify };
      const next = await searchResolve(payload, { signal: controller.signal });
      setResolved(next);
    } catch (e: any) {
      if (controller.signal.aborted) return;
      setResolved(null);
      setError(e?.message || "Search resolve failed");
    } finally {
      if (!controller.signal.aborted) {
        setResolveLoading(false);
      }
    }
  }

  const handleSubmit = async () => {
    setSuggestOpen(false);
    await runResolve(query, "generic");
  };

  const handleSuggestionClick = async (s: Suggestion) => {
    const nextMode: SearchResolveMode = s.kind;
    const nextQuery = s.subtitle ? `${s.name} ${s.subtitle}` : s.name;
    setQuery(nextQuery);
    setSuggestOpen(false);
    await runResolve(nextQuery, nextMode, s.spotify);
  };

  const showSuggestBox = suggestOpen && normalizeQuery(query).length >= 2;
  const showResults = Boolean(resolved) || resolveLoading;
  const showArtistChannels = resolvedArtistChannels.local.length > 0 || resolvedArtistChannels.youtube.length > 0;

  const handleArtistChannelClick = (channelId: string) => {
    const id = channelId.trim();
    if (!id) return;
    const internal = `/artist/${encodeURIComponent(id)}`;
    try {
      navigate(internal);
    } catch {
      window.open(`https://www.youtube.com/channel/${encodeURIComponent(id)}`, "_blank", "noopener,noreferrer");
    }
  };

  return (
    <div className="p-4 max-w-4xl mx-auto pb-32">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void handleSubmit();
        }}
        className="mb-4"
      >
        <div className="relative">
          <SearchIcon className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-muted-foreground" />

          <div className="flex gap-2">
            <Input
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setSuggestOpen(true);
              }}
              onFocus={() => setSuggestOpen(true)}
              placeholder="Search songs, artists or playlists"
              className="pl-12 h-12"
            />
            <Button type="submit" className="h-12">
              Search
            </Button>
          </div>

          {showSuggestBox && (
            <div className="absolute z-20 mt-2 w-full rounded-lg border border-border bg-card/95 backdrop-blur p-2">
              {suggestLoading && <div className="px-2 py-2 text-sm text-muted-foreground">Searching…</div>}

              {!suggestLoading && flatSuggestions.length === 0 && (
                <div className="px-2 py-2 text-sm text-muted-foreground">No suggestions.</div>
              )}

              <div className="max-h-72 overflow-auto">
                {flatSuggestions.map((s) => (
                  <button
                    key={`${s.kind}:${s.id}`}
                    type="button"
                    onClick={() => void handleSuggestionClick(s)}
                    className="w-full text-left flex items-center gap-3 rounded-md px-2 py-2 hover:bg-accent"
                  >
                    <div className="w-8 h-8 rounded bg-muted overflow-hidden shrink-0">
                      {s.imageUrl ? <img src={s.imageUrl} alt={s.name} className="w-full h-full object-cover" /> : null}
                    </div>

                    <div className="min-w-0 flex-1">
                      <div className="font-medium truncate">{s.name}</div>
                      {s.subtitle ? <div className="text-xs text-muted-foreground truncate">{s.subtitle}</div> : null}
                    </div>

                    <div className="text-xs text-muted-foreground inline-flex items-center gap-1">
                      {s.kind === "artist" ? <User className="w-3 h-3" /> : null}
                      {s.kind === "album" ? <ListMusic className="w-3 h-3" /> : null}
                      {s.kind === "track" ? <Music className="w-3 h-3" /> : null}
                      <span className="capitalize">{s.kind}</span>
                    </div>
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      </form>

      {error && (
        <div className="mb-4 rounded-lg border border-border bg-card/60 px-3 py-2 text-sm text-red-400">{error}</div>
      )}

      {showResults && (
        <div>
          {resolveLoading && <p className="text-muted-foreground mb-2">Searching…</p>}

          {!resolveLoading && resolved && (
            <div className="mb-4 text-xs text-muted-foreground">
              decision: <span className="font-medium">{resolved.decision}</span>
            </div>
          )}

          {showArtistChannels && (
            <section className="mb-8">
              <div className="flex gap-4 overflow-x-auto pb-2">
                {[...resolvedArtistChannels.local, ...resolvedArtistChannels.youtube].map((c) => (
                  <button
                    key={c.channelId}
                    type="button"
                    onClick={() => handleArtistChannelClick(c.channelId)}
                    className="shrink-0 w-20 text-center"
                  >
                    <div className="mx-auto w-14 h-14 rounded-full bg-muted overflow-hidden flex items-center justify-center">
                      {c.thumbnailUrl ? (
                        <img src={c.thumbnailUrl} alt={c.title} className="w-full h-full object-cover" />
                      ) : (
                        <span className="text-sm font-semibold text-muted-foreground">{firstLetter(c.title)}</span>
                      )}
                    </div>
                    <div className="mt-2 text-xs font-medium truncate">{c.title}</div>
                  </button>
                ))}
              </div>
            </section>
          )}

          {/* SONGS (local tracks + youtube videos) */}
          {resultsSongs.length > 0 && (
            <section className="mb-10">
              <h2 className="flex items-center gap-2 text-xl font-bold mb-4">
                <Music className="w-5 h-5" /> Songs
              </h2>

              {resultsSongs.map((s) => (
                <button
                  key={s.key}
                  type="button"
                  onClick={() => playTrack(s.youtubeId, s.title, s.artist, s.trackId)}
                  className="block w-full text-left py-2 border-b border-border hover:bg-white/5"
                >
                  <div className="font-medium truncate">{s.title}</div>
                  <div className="text-sm text-muted-foreground truncate">{s.artist}</div>
                </button>
              ))}
            </section>
          )}

          {/* PLAYLISTS */}
          {(resultsPlaylists.local.length > 0 || resultsPlaylists.youtube.length > 0) && (
            <section>
              <h2 className="flex items-center gap-2 text-xl font-bold mb-4">
                <ListMusic className="w-5 h-5" /> Playlists
              </h2>

              {resultsPlaylists.local.map((p) => (
                <Link
                  key={p.id}
                  to={`/playlist/${p.id}`}
                  className="block w-full text-left py-2 border-b border-border hover:bg-white/5"
                >
                  <div className="font-medium truncate">{p.title}</div>
                </Link>
              ))}

              {resultsPlaylists.youtube.map((p) => (
                <a
                  key={p.id}
                  href={`https://www.youtube.com/playlist?list=${encodeURIComponent(p.id)}`}
                  target="_blank"
                  rel="noreferrer"
                  className="block w-full text-left py-2 border-b border-border hover:bg-white/5"
                >
                  <div className="font-medium truncate">{p.title}</div>
                  <div className="text-sm text-muted-foreground truncate">{p.channelTitle}</div>
                </a>
              ))}
            </section>
          )}

          {!resolveLoading &&
            resolved &&
            resultsSongs.length === 0 &&
            resultsPlaylists.local.length === 0 &&
            resultsPlaylists.youtube.length === 0 && (
              <div className="text-sm text-muted-foreground mt-6">
                No results for <span className="font-semibold">{resolved.q}</span>.
              </div>
            )}
        </div>
      )}
    </div>
  );
}
