// -----------------------------------------------------------
// Purple Music – Search.tsx (Hybrid Fuzzy Search + Supabase)
// -----------------------------------------------------------

import { useState, useEffect, useRef, useMemo } from "react";
import { Search as SearchIcon, Clock, Music, ListMusic, User, History } from "lucide-react";
import { Input } from "@/components/ui/input";
import { useLanguage } from "@/contexts/LanguageContext";
import { useNavigate } from "react-router-dom";
import { usePlayer } from "@/contexts/PlayerContext";
import { usePi } from "@/contexts/PiContext";
import { externalSupabase } from "@/lib/externalSupabase";
import Fuse from "@/lib/fuse"; // ← fuzzy engine (UMD build)

interface Track {
  id: string;
  external_id: string;
  title: string;
  artist: string;
  cover_url: string | null;
  duration: number | null;
}

interface Playlist {
  id: string;
  title: string;
  cover_url: string | null;
  description: string | null;
}

interface ArtistGroup {
  artist: string;
  tracks: Track[];
}

interface SearchResults {
  tracks: Track[];
  playlists: Playlist[];
  artistGroups: ArtistGroup[];
}

type FilterTab = "playlists" | "songs" | "artists";

const MAX_HISTORY = 10;

const Search = () => {
  const { t } = useLanguage();
  const navigate = useNavigate();
  const { playTrack } = usePlayer();
  const { user } = usePi();
  const isAuthenticated = Boolean(user);

  const [searchTerm, setSearchTerm] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [activeTab, setActiveTab] = useState<FilterTab>("playlists");

  const [results, setResults] = useState<SearchResults>({
    tracks: [],
    playlists: [],
    artistGroups: [],
  });

  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [history, setHistory] = useState<string[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  // -----------------------------------------------
  // AbortController for canceling old Supabase queries
  // -----------------------------------------------
  const abortRef = useRef<AbortController | null>(null);

  // -----------------------------------------------
  // Load search history from localStorage
  // -----------------------------------------------
  useEffect(() => {
    const stored = localStorage.getItem("pm_search_history");
    if (stored) setHistory(JSON.parse(stored));
  }, []);

  const saveHistory = (term: string) => {
    if (!term) return;
    const updated = [term, ...history.filter((x) => x !== term)].slice(0, MAX_HISTORY);
    setHistory(updated);
    localStorage.setItem("pm_search_history", JSON.stringify(updated));
  };

  // -----------------------------------------------
  // Debounce input
  // -----------------------------------------------
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(searchTerm.trim()), 250);
    return () => clearTimeout(timer);
  }, [searchTerm]);

  useEffect(() => {
    if (searchTerm.length > 0) setActiveTab("playlists");
  }, [searchTerm]);

  // -----------------------------------------------
  // Highlight matched segments
  // -----------------------------------------------
  const highlightMatch = (text: string, q: string) => {
    if (!q) return text;
    const regex = new RegExp(`(${q})`, "gi");
    return text.replace(regex, "<mark>$1</mark>");
  };

  // -----------------------------------------------
  // HYBRID SEARCH PIPELINE (C)
  // 1. fuzzy matching local suggestions (instant)
  // 2. supabase confirmation & fetching
  // -----------------------------------------------
  useEffect(() => {
    if (!debouncedSearch) {
      setResults({ tracks: [], playlists: [], artistGroups: [] });
      setSuggestions([]);
      return;
    }

    const runSearch = async () => {
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;

      setIsLoading(true);

      // -------------------------------------------
      // STEP 1: Fuzzy Suggestions (local only)
      // -------------------------------------------
      const searchSpace = [
        ...history,
        ...suggestions,
      ];

      const fuse = new Fuse(searchSpace, {
        includeScore: true,
        shouldSort: true,
        threshold: 0.35, // SUPERIOR fuzzy accuracy
      });

      const fuzzyOutput = fuse.search(debouncedSearch).map((x) => x.item);

      // Merge fuzzy output + history results
      const combinedSuggestions = Array.from(
        new Set([...fuzzyOutput, ...searchSpace])
      )
        .filter((x) => x.toLowerCase().includes(debouncedSearch.toLowerCase()))
        .slice(0, 10);

      setSuggestions(combinedSuggestions);

      // -------------------------------------------
      // STEP 2: Supabase database search
      // -------------------------------------------
      try {
        const pattern = `%${debouncedSearch}%`;

        const [tracksRes, playlistsRes, artistRes] = await Promise.all([
          externalSupabase
            .from("tracks")
            .select("id, external_id, title, artist, cover_url, duration")
            .or(`title.ilike.${pattern},artist.ilike.${pattern}`)
            .limit(25)
            .abortSignal(controller.signal),

          externalSupabase
            .from("playlists")
            .select("id, title, cover_url, description")
            .ilike("title", pattern)
            .limit(25)
            .abortSignal(controller.signal),

          externalSupabase
            .from("tracks")
            .select("id, external_id, title, artist, cover_url, duration")
            .ilike("artist", pattern)
            .limit(25)
            .abortSignal(controller.signal),
        ]);

        const tracks: Track[] = tracksRes.data || [];

        const playlistsWithCounts = await Promise.all(
          (playlistsRes.data || []).map(async (playlist) => {
            const { count } = await externalSupabase
              .from("playlist_tracks")
              .select("*", { count: "exact", head: true })
              .eq("playlist_id", playlist.id);

            return { playlist, count: count || 0 };
          })
        );

        const playlists: Playlist[] = playlistsWithCounts
          .filter((x) => x.count > 0)
          .map((x) => x.playlist);

        const artistMap = new Map<string, Track[]>();
        (artistRes.data || []).forEach((track) => {
          const list = artistMap.get(track.artist) || [];
          artistMap.set(track.artist, [...list, track]);
        });

        const artistGroups = Array.from(artistMap.entries())
          .map(([artist, tracks]) => ({
            artist,
            tracks: tracks.sort((a, b) => a.title.localeCompare(b.title)),
          }))
          .sort((a, b) => a.artist.localeCompare(b.artist));

        setResults({ tracks, playlists, artistGroups });

        saveHistory(debouncedSearch);
      } catch (err) {
        if ((err as any).name !== "AbortError") {
          console.error("Search error:", err);
        }
      } finally {
        setIsLoading(false);
      }
    };

    runSearch();
  }, [debouncedSearch]);

  // -----------------------------------------------
  // Helpers
  // -----------------------------------------------
  const handleTrackClick = (track: Track) => {
    playTrack(track.external_id, track.title, track.artist, track.id);
  };

  const handlePlaylistClick = (id: string) => {
    navigate(`/playlist/${id}`);
  };

  const handleSuggestionClick = (term: string) => {
    setSearchTerm(term);
  };

  const formatDuration = (seconds: number | null) => {
    if (!seconds) return "";
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m}:${s.toString().padStart(2, "0")}`;
  };

  const hasResults =
    results.tracks.length > 0 ||
    results.playlists.length > 0 ||
    results.artistGroups.length > 0;

  // -----------------------------------------------
  // Browse categories
  // -----------------------------------------------
  const browseCategories = useMemo(
    () => [
      { id: 1, title: t("genre_pop"), color: "from-pink-500 to-purple-500" },
      { id: 2, title: t("genre_rock"), color: "from-red-500 to-orange-500" },
      { id: 3, title: t("genre_hiphop"), color: "from-yellow-500 to-green-500" },
      { id: 4, title: t("genre_electronic"), color: "from-blue-500 to-cyan-500" },
      { id: 5, title: t("genre_jazz"), color: "from-indigo-500 to-purple-500" },
      { id: 6, title: t("genre_classical"), color: "from-gray-500 to-slate-500" },
    ],
    [t]
  );

  // -----------------------------------------------
  // UI
  // -----------------------------------------------
  return (
    <div className="relative flex-1 overflow-y-auto pb-32">
      <div className="p-4 md:p-8 max-w-3xl mx-auto">

        {/* SEARCH BAR + AUTOCOMPLETE */}
        <div className="relative mb-8">
          <SearchIcon className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-muted-foreground" />

          <Input
            type="text"
            placeholder={t("search_placeholder")}
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="pl-12 h-12 bg-card border-border text-foreground"
            autoFocus={isAuthenticated}
            disabled={!isAuthenticated}
          />

          {searchTerm.length > 0 && (
            <div className="absolute z-50 mt-2 w-full bg-card border border-border rounded-lg shadow-lg max-h-80 overflow-y-auto animate-fade-in">

              {history.length > 0 && (
                <>
                  <h4 className="px-3 pt-3 pb-1 text-xs text-muted-foreground uppercase flex items-center gap-2">
                    <History className="w-4 h-4" /> {t("recent_searches")}
                  </h4>

                  {history.map((h) => (
                    <div
                      key={h}
                      onClick={() => handleSuggestionClick(h)}
                      className="px-3 py-2 text-sm cursor-pointer hover:bg-white/5"
                    >
                      {h}
                    </div>
                  ))}
                </>
              )}

              {suggestions.length > 0 && (
                <>
                  <h4 className="px-3 pt-3 pb-1 text-xs text-muted-foreground uppercase flex items-center gap-2">
                    <SearchIcon className="w-4 h-4" /> {t("suggestions")}
                  </h4>

                  {suggestions.map((s) => (
                    <div
                      key={s}
                      onClick={() => handleSuggestionClick(s)}
                      className="px-3 py-2 text-sm cursor-pointer hover:bg-white/5"
                      dangerouslySetInnerHTML={{ __html: highlightMatch(s, searchTerm) }}
                    />
                  ))}
                </>
              )}
            </div>
          )}
        </div>

        {/* LOADING */}
        {isLoading && (
          <p className="text-muted-foreground">{t("search_loading")}...</p>
        )}

        {/* SEARCH RESULTS */}
        {!isLoading && debouncedSearch && hasResults && (
          <div className="animate-fade-in space-y-10">

            {/* PLAYLISTS */}
            {results.playlists.length > 0 && (
              <section>
                <h2 className="text-xl font-bold flex items-center gap-2 mb-3">
                  <ListMusic className="w-5 h-5" /> {t("search_section_playlists")}
                </h2>

                <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
                  {results.playlists.map((p) => (
                    <div
                      key={p.id}
                      className="cursor-pointer group"
                      onClick={() => handlePlaylistClick(p.id)}
                    >
                      <div className="aspect-square rounded-lg overflow-hidden bg-card mb-2 transition-all group-hover:scale-105">
                        {p.cover_url ? (
                          <img src={p.cover_url} className="w-full h-full object-cover" />
                        ) : (
                          <div className="w-full h-full flex items-center justify-center bg-muted">
                            <ListMusic className="w-8 h-8 text-muted-foreground" />
                          </div>
                        )}
                      </div>
                      <h3 className="text-sm font-medium">{p.title}</h3>
                      {p.description && (
                        <p className="text-xs text-muted-foreground line-clamp-1">
                          {p.description}
                        </p>
                      )}
                    </div>
                  ))}
                </div>
              </section>
            )}

            {/* SONGS */}
            {results.tracks.length > 0 && (
              <section>
                <h2 className="text-xl font-bold flex itemscenter gap-2 mb-3">
                  <Music className="w-5 h-5" /> {t("search_section_songs")}
                </h2>

                <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
                  {results.tracks.map((t) => (
                    <div
                      key={t.id}
                      className="cursor-pointer group"
                      onClick={() => handleTrackClick(t)}
                    >
                      <div className="aspect-square rounded-lg overflow-hidden bg-card mb-2 transition-all group-hover:scale-105">
                        {t.cover_url ? (
                          <img src={t.cover_url} className="w-full h-full object-cover" />
                        ) : (
                          <div className="w-full h-full flex items-center justify-center bg-muted">
                            <Music className="w-8 h-8 text-muted-foreground" />
                          </div>
                        )}
                      </div>

                      <h3 className="text-sm font-medium line-clamp-1">{t.title}</h3>
                      <p className="text-xs text-muted-foreground">{t.artist}</p>
                    </div>
                  ))}
                </div>
              </section>
            )}

            {/* ARTISTS */}
            {results.artistGroups.length > 0 && (
              <section>
                <h2 className="text-xl font-bold flex items-center gap-2 mb-3">
                  <User className="w-5 h-5" /> {t("search_section_artists")}
                </h2>

                {results.artistGroups.map((g) => (
                  <div key={g.artist} className="mb-6">
                    <h3 className="text-lg font-semibold text-muted-foreground mb-2">
                      {g.artist}
                    </h3>

                    <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
                      {g.tracks.map((track) => (
                        <div
                          key={track.id}
                          className="cursor-pointer group"
                          onClick={() => handleTrackClick(track)}
                        >
                          <div className="aspect-square rounded-lg overflow-hidden bg-card mb-2 transition-all group-hover:scale-105">
                            {track.cover_url ? (
                              <img src={track.cover_url} className="w-full h-full object-cover" />
                            ) : (
                              <div className="w-full h-full flex items-center justify-center bg-muted">
                                <Music className="w-8 h-8 text-muted-foreground" />
                              </div>
                            )}
                          </div>

                          <h4 className="text-sm font-medium line-clamp-1">
                            {track.title}
                          </h4>

                          {track.duration && (
                            <p className="text-xs text-muted-foreground flex items-center gap-1">
                              <Clock className="w-3 h-3" /> {formatDuration(track.duration)}
                            </p>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </section>
            )}
          </div>
        )}

        {/* DEFAULT CONTENT */}
        {!debouncedSearch && (
          <div className="animate-fade-in">
            <h2 className="text-2xl font-bold mb-4">{t("browse_all")}</h2>

            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
              {browseCategories.map((cat) => (
                <div
                  key={cat.id}
                  className={`h-32 rounded-lg bg-gradient-to-br ${cat.color} flex items-center justify-center text-white font-bold text-lg cursor-pointer hover:scale-105 transition-transform`}
                >
                  {cat.title}
                </div>
              ))}
            </div>
          </div>
        )}

      </div>
    </div>
  );
};

export default Search;
