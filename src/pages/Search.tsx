import { FormEvent, useEffect, useRef, useState } from "react";
import { Flame, Loader2, Play, Search as SearchIcon } from "lucide-react";
import { useNavigate, useSearchParams } from "react-router-dom";
import PlaylistListItem from "@/components/PlaylistListItem";
import SearchSuggestList from "@/components/search/SearchSuggestList";
import { TrackRow } from "@/components/TrackRow";
import { Input } from "@/components/ui/input";
import { usePlayer } from "@/contexts/PlayerContext";
import { adaptSearchPlaylistResult } from "@/lib/adapters/playlists";
import {
  ingestSearchSelection,
  normalizeSearchSections,
  pickTopResult,
  searchResolve,
  searchSuggest,
  type SearchResultItem,
  type SearchSection,
  type SearchSuggestItem,
  type SearchTrackItem,
} from "@/lib/api/search";

const SUGGEST_DEBOUNCE_MS = 250;
const MAX_SUGGESTIONS = 15;

type SongsSection = Extract<SearchSection, { kind: "songs" }>;
type ArtistsSection = Extract<SearchSection, { kind: "artists" }>;
type AlbumsSection = Extract<SearchSection, { kind: "albums" }>;
type PlaylistsSection = Extract<SearchSection, { kind: "playlists" }>;

const splitArtists = (value?: string | null): string[] => {
  if (!value) return [];
  const tokens = value.split(/[·,/|]/g).map((part) => part.trim()).filter(Boolean);
  return tokens.length > 0 ? tokens : [value.trim()].filter(Boolean);
};

const asQueueItem = (track: SearchTrackItem) => ({
  youtubeVideoId: track.youtubeVideoId,
  title: track.title || "Song",
  artist: splitArtists(track.subtitle)?.[0] || track.artists?.[0] || track.title,
  thumbnailUrl: track.imageUrl ?? undefined,
});

const clampIndex = (index: number, listLength: number) => {
  if (listLength <= 0) return 0;
  return Math.min(Math.max(index, 0), listLength - 1);
};

export default function Search() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const { playTrack, playCollection } = usePlayer();

  const [query, setQuery] = useState(() => searchParams.get("q") ?? "");
  const [sections, setSections] = useState<SearchSection[]>([]);
  const [topResult, setTopResult] = useState<SearchResultItem | null>(null);
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
      setSections(normalizeSearchSections(res?.sections));
      setTopResult(pickTopResult(res));
      const next = new URLSearchParams(searchParams);
      next.set("q", q);
      setSearchParams(next);
    } catch {
      setError("Unable to load search results.");
      setSections([]);
      setTopResult(null);
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

  const songsSection = sections.find((section): section is SongsSection => section.kind === "songs");
  const artistsSection = sections.find((section): section is ArtistsSection => section.kind === "artists");
  const albumsSection = sections.find((section): section is AlbumsSection => section.kind === "albums");
  const playlistsSection = sections.find((section): section is PlaylistsSection => section.kind === "playlists");

  const playSongAtIndex = (index: number) => {
    if (!songsSection || songsSection.items.length === 0) return;
    const queue = songsSection.items.map(asQueueItem).filter((t) => t.youtubeVideoId);
    if (queue.length === 0) return;

    const startIndex = clampIndex(index, queue.length);
    playCollection(queue, startIndex, "song", null);

    const chosen = songsSection.items[startIndex];
    if (chosen?.youtubeVideoId) {
      void ingestSearchSelection({
        type: "song",
        id: chosen.youtubeVideoId,
        title: chosen.title,
        subtitle: chosen.subtitle,
        imageUrl: chosen.imageUrl,
      });
    }
  };

  const openEntity = (item: SearchResultItem) => {
    const id = (item.endpointPayload || item.id || "").trim();
    if (!id) return;

    if (item.kind === "artist") {
      void ingestSearchSelection({ type: "artist", id, title: item.title, subtitle: item.subtitle, imageUrl: item.imageUrl });
      navigate(`/artist/${encodeURIComponent(id)}`);
      return;
    }

    if (item.kind === "album") {
      void ingestSearchSelection({ type: "album", id, title: item.title, subtitle: item.subtitle, imageUrl: item.imageUrl });
      navigate(`/playlist/${encodeURIComponent(id)}`, { state: { playlistId: id, playlistTitle: item.title, playlistCover: item.imageUrl ?? null } });
      return;
    }

    if (item.kind === "playlist") {
      void ingestSearchSelection({ type: "playlist", id, title: item.title, subtitle: item.subtitle, imageUrl: item.imageUrl });
      navigate(`/playlist/${encodeURIComponent(id)}`, { state: { playlistId: id, playlistTitle: item.title, playlistCover: item.imageUrl ?? null } });
      return;
    }

    if (item.endpointType === "watch" && id.length === 11) {
      void ingestSearchSelection({ type: "song", id, title: item.title, subtitle: item.subtitle, imageUrl: item.imageUrl });
      playTrack(
        {
          youtubeVideoId: id,
          title: item.title,
          artist: splitArtists(item.subtitle)[0] || item.subtitle || item.title,
          thumbnailUrl: item.imageUrl ?? undefined,
        },
        "song"
      );
    }
  };

  const handleTopPlay = () => {
    if (!topResult) return;
    openEntity(topResult);
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

  const renderTopResult = () => {
    if (!topResult) return null;
    const artists = splitArtists(topResult.subtitle);
    const label =
      topResult.kind === "artist" ? "Artist" : topResult.kind === "album" ? "Album" : topResult.kind === "playlist" ? "Playlist" : "Top result";

    return (
      <div className="mt-6 rounded-3xl bg-gradient-to-r from-neutral-900 to-neutral-800 p-4 shadow-lg">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
          <div className={`h-24 w-24 overflow-hidden ${topResult.kind === "artist" ? "rounded-full" : "rounded-2xl"} bg-neutral-800`}>
            {topResult.imageUrl ? (
              <img src={topResult.imageUrl} alt={topResult.title} className="h-full w-full object-cover" loading="lazy" />
            ) : null}
          </div>

          <div className="flex-1 space-y-1">
            <div className="flex items-center gap-2 text-xs uppercase tracking-wide text-neutral-400">
              <Flame className="h-4 w-4 text-[#F6C66D]" />
              <span>{label}</span>
            </div>
            <h2 className="text-2xl font-bold leading-tight text-white">{topResult.title}</h2>
            {artists.length > 0 ? <p className="text-sm text-neutral-300">{artists.join(" · ")}</p> : null}
          </div>

          <div className="flex gap-3">
            {topResult.endpointType === "watch" ? (
              <button
                type="button"
                onClick={handleTopPlay}
                className="inline-flex items-center gap-2 rounded-full bg-white px-4 py-2 text-sm font-semibold text-black transition hover:opacity-90"
              >
                <Play className="h-4 w-4" />
                Play
              </button>
            ) : (
              <button
                type="button"
                onClick={() => openEntity(topResult)}
                className="inline-flex items-center gap-2 rounded-full border border-white/20 px-4 py-2 text-sm font-semibold text-white transition hover:border-white/40"
              >
                Open
              </button>
            )}
          </div>
        </div>
      </div>
    );
  };

  const renderSongs = () => {
    if (!songsSection || songsSection.items.length === 0) return null;
    return (
      <section className="mt-8 space-y-3">
        <div className="text-sm font-semibold text-white">Songs</div>
        <div className="overflow-hidden rounded-2xl border border-white/5 bg-neutral-900/60">
          {songsSection.items.slice(0, 5).map((song, index) => (
            <TrackRow
              key={song.youtubeVideoId || `${song.id}-${index}`}
              index={index}
              title={song.title}
              artist={splitArtists(song.subtitle)[0] || song.artists?.[0]}
              thumbnailUrl={song.imageUrl ?? undefined}
              onSelect={() => playSongAtIndex(index)}
            />
          ))}
        </div>
      </section>
    );
  };

  const renderArtists = () => {
    if (!artistsSection || artistsSection.items.length === 0) return null;
    return (
      <section className="mt-8 space-y-3">
        <div className="text-sm font-semibold text-white">Artists</div>
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4">
          {artistsSection.items.slice(0, 8).map((artist, idx) => (
            <button
              key={`${artist.id}-${idx}`}
              type="button"
              onClick={() =>
                openEntity({
                  id: artist.id,
                  title: artist.name,
                  imageUrl: artist.imageUrl ?? null,
                  subtitle: "Artist",
                  endpointType: "browse",
                  endpointPayload: artist.id,
                  kind: "artist",
                })
              }
              className="group flex flex-col items-center gap-2 rounded-xl border border-white/5 bg-white/5 px-3 py-4 transition hover:border-[#F6C66D]/50 hover:bg-white/10"
            >
              <div className="h-20 w-20 overflow-hidden rounded-full bg-neutral-800">
                {artist.imageUrl ? (
                  <img src={artist.imageUrl} alt={artist.name} className="h-full w-full object-cover" loading="lazy" />
                ) : null}
              </div>
              <div className="w-full truncate text-center text-sm font-semibold text-white">{artist.name}</div>
            </button>
          ))}
        </div>
      </section>
    );
  };

  const renderAlbums = () => {
    if (!albumsSection || albumsSection.items.length === 0) return null;
    return (
      <section className="mt-8 space-y-3">
        <div className="text-sm font-semibold text-white">Albums</div>
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4">
          {albumsSection.items.slice(0, 8).map((album, idx) => (
            <button
              key={`${album.id}-${idx}`}
              type="button"
              onClick={() =>
                openEntity({
                  id: album.id,
                  title: album.title,
                  imageUrl: album.imageUrl ?? null,
                  subtitle: album.artist ?? album.channelTitle ?? "Album",
                  endpointType: "browse",
                  endpointPayload: album.id,
                  kind: "album",
                })
              }
              className="flex flex-col gap-2 rounded-xl border border-white/5 bg-white/5 p-3 text-left transition hover:border-[#F6C66D]/50 hover:bg-white/10"
            >
              <div className="aspect-square w-full overflow-hidden rounded-lg bg-neutral-800">
                {album.imageUrl ? (
                  <img src={album.imageUrl} alt={album.title} className="h-full w-full object-cover" loading="lazy" />
                ) : null}
              </div>
              <div className="space-y-1">
                <p className="truncate text-sm font-semibold text-white">{album.title}</p>
                <p className="truncate text-xs text-neutral-400">{album.artist || album.channelTitle || "Album"}</p>
              </div>
            </button>
          ))}
        </div>
      </section>
    );
  };

  const renderPlaylists = () => {
    if (!playlistsSection || playlistsSection.items.length === 0) return null;

    return (
      <section className="mt-8 space-y-3">
        <div className="text-sm font-semibold text-white">Playlists</div>
        <div className="space-y-2">
          {playlistsSection.items.map((playlist) => {
            const adapted = adaptSearchPlaylistResult({
              id: playlist.id,
              title: playlist.title,
              subtitle: playlist.subtitle ?? undefined,
              imageUrl: playlist.imageUrl ?? undefined,
              endpointPayload: playlist.id,
            });
            if (!adapted) return null;

            return (
              <PlaylistListItem
                key={playlist.id}
                title={adapted.title}
                subtitle={adapted.subtitle}
                imageUrl={adapted.imageUrl ?? undefined}
                badge={adapted.badge}
                onSelect={() =>
                  navigate(`/playlist/${encodeURIComponent(adapted.browseId)}`, {
                    state: adapted.navState,
                  })
                }
              />
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

        {!loading && submitted && !error && !topResult && sections.length === 0 ? (
          <div className="mt-10 text-sm text-neutral-400">No results for “{lastSearched}”. Try another search.</div>
        ) : null}

        {renderTopResult()}
        {renderSongs()}
        {renderArtists()}
        {renderAlbums()}
        {renderPlaylists()}
      </div>
    </div>
  );
}
