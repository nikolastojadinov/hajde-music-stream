import { useState, useEffect, useMemo, useRef } from "react";
import {
  Search as SearchIcon,
  Music,
  ListMusic,
  User,
  History,
  Youtube,
  Clock,
} from "lucide-react";
import { Input } from "@/components/ui/input";
import { useLanguage } from "@/contexts/LanguageContext";
import { useNavigate } from "react-router-dom";
import { usePlayer } from "@/contexts/PlayerContext";
import { usePi } from "@/contexts/PiContext";
import { externalSupabase } from "@/lib/externalSupabase";
import { buildFuseEngine, FuseEngine } from "@/lib/fuseEngine";
import {
  getCachedArtistsSearchDataset,
  getCachedDataset,
  loadArtistsSearchDataset,
  loadSearchDataset,
} from "@/lib/searchDataset";
import type { SearchDatasetItem } from "@/lib/searchDataset";

// ===== Types =====

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

interface YoutubeSearchItem {
  id: string;
  type: "video" | "playlist";
  title: string;
  channelTitle: string;
  thumbnailUrl: string | null;
}

// ===== Helpers =====

// YouTube ISO 8601 duration (e.g. PT3M20S) → seconds
const parseYoutubeDuration = (iso: string | undefined | null): number | null => {
  if (!iso) return null;
  const match = iso.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
  if (!match) return null;
  const hours = parseInt(match[1] || "0", 10);
  const minutes = parseInt(match[2] || "0", 10);
  const seconds = parseInt(match[3] || "0", 10);
  return hours * 3600 + minutes * 60 + seconds;
};

const formatDuration = (seconds: number | null) => {
  if (!seconds || seconds <= 0) return "";
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${mins}:${secs.toString().padStart(2, "0")}`;
};

const ytApiKey = import.meta.env.VITE_YOUTUBE_API_KEY as string | undefined;

// ===== Component =====

const MAX_HISTORY = 10;
const SUGGESTION_LIMIT = 10;
const DATASET_REFRESH_MS = 24 * 60 * 60 * 1000;

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

  const [history, setHistory] = useState<string[]>([]);
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [autocompleteSuggestions, setAutocompleteSuggestions] = useState<string[]>([]);
  const [fuseVersion, setFuseVersion] = useState(0);
  const [artistsSearchDataset, setArtistsSearchDataset] = useState<SearchDatasetItem[]>([]);

  const fuseRef = useRef<FuseEngine | null>(null);

  const rebuildFuse = (dataset: SearchDatasetItem[]) => {
    if (!dataset.length) return;
    fuseRef.current = buildFuseEngine(dataset);
    setFuseVersion((version) => version + 1);
  };

  const [isLoadingSupabase, setIsLoadingSupabase] = useState(false);
  const [isLoadingYoutube, setIsLoadingYoutube] = useState(false);
  const [ytResults, setYtResults] = useState<YoutubeSearchItem[]>([]);
  const [ytError, setYtError] = useState<string | null>(null);

  const hasLocalResults =
    results.tracks.length > 0 ||
    results.playlists.length > 0 ||
    results.artistGroups.length > 0;

  const hasYtResults = ytResults.length > 0;

  // ===== Local search history =====

  useEffect(() => {
    const stored = localStorage.getItem("pm_search_history");
    if (stored) {
      try {
        setHistory(JSON.parse(stored));
      } catch {
        // ignore
      }
    }
  }, []);

  const saveHistory = (term: string) => {
    if (!term) return;
    const updated = [term, ...history.filter((x) => x !== term)].slice(
      0,
      MAX_HISTORY
    );
    setHistory(updated);
    localStorage.setItem("pm_search_history", JSON.stringify(updated));
  };

  // ===== Fuse + artists_search dataset hydration (for autocomplete) =====
  useEffect(() => {
    const cachedDataset = getCachedDataset();
    if (cachedDataset.length) {
      rebuildFuse(cachedDataset);
    }

    const cachedArtistsSearch = getCachedArtistsSearchDataset();
    if (cachedArtistsSearch.length) {
      setArtistsSearchDataset(cachedArtistsSearch);
    }

    let cancelled = false;

    const hydrateDataset = async (force = false) => {
      try {
        const dataset = await loadSearchDataset(force ? { force: true } : {});
        if (!cancelled && dataset.length) {
          rebuildFuse(dataset);
        }
      } catch (err) {
        console.error("search dataset load failed", err);
      }
    };

    const hydrateArtistsSearch = async (force = false) => {
      try {
        const dataset = await loadArtistsSearchDataset(force ? { force: true } : {});
        if (!cancelled && dataset.length) {
          setArtistsSearchDataset(dataset);
        }
      } catch (err) {
        console.error("artists_search dataset load failed", err);
      }
    };

    hydrateDataset();
    hydrateArtistsSearch();

    const interval = setInterval(() => {
      hydrateDataset(true);
      hydrateArtistsSearch(true);
    }, DATASET_REFRESH_MS);

    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, []);

  // ===== Debounce input =====

  useEffect(() => {
    const timer = setTimeout(
      () => setDebouncedSearch(searchTerm.trim()),
      350
    );
    return () => clearTimeout(timer);
  }, [searchTerm]);

  // Reset active tab when new search starts
  useEffect(() => {
    if (searchTerm.length > 0) {
      setActiveTab("playlists");
    }
  }, [searchTerm]);


  // ===== Autocomplete dropdown suggestions =====
  // ONLY artists_search artists (Fuse bypassed)
  useEffect(() => {
    if (!searchTerm.trim()) {
      setAutocompleteSuggestions([]);
      return;
    }

    const query = searchTerm.trim().toLowerCase();
    const seen = new Set<string>();
    const next: string[] = [];

    const artistsSearchMatches = artistsSearchDataset
      .filter((item) => item.type === "artist" && item.source === "artists_search")
      .map((item) => {
        const label = (item.label || item.artist).trim();
        return { label, isPopular: Boolean(item.isPopular) };
      })
      .filter(({ label }) => label && label.toLowerCase().includes(query))
      .sort((a, b) => {
        if (a.isPopular !== b.isPopular) return a.isPopular ? -1 : 1;
        return a.label.localeCompare(b.label);
      });

    artistsSearchMatches.forEach(({ label }) => {
      if (next.length >= SUGGESTION_LIMIT) return;
      const key = label.toLowerCase();
      if (seen.has(key)) return;
      seen.add(key);
      next.push(label);
    });

    setAutocompleteSuggestions(next);
  }, [searchTerm, artistsSearchDataset]);

  // ===== Supabase search =====

  useEffect(() => {
    if (!debouncedSearch) {
      setResults({ tracks: [], playlists: [], artistGroups: [] });
      setSuggestions([]);
      setYtResults([]);
      setYtError(null);
      return;
    }

    const runSupabaseSearch = async () => {
      setIsLoadingSupabase(true);
      setYtResults([]);
      setYtError(null);

      try {
        const pattern = `%${debouncedSearch}%`;

        // Parallel local queries
        const [tracksRes, playlistsRes, artistRes] = await Promise.all([
          externalSupabase
            .from("tracks")
            .select("id, external_id, title, artist, cover_url, duration")
            .or(`title.ilike.${pattern},artist.ilike.${pattern}`)
            .limit(30),

          externalSupabase
            .from("playlists")
            .select("id, title, cover_url, description")
            .ilike("title", pattern)
            .limit(30),

          externalSupabase
            .from("tracks")
            .select("id, external_id, title, artist, cover_url, duration")
            .ilike("artist", pattern)
            .limit(60),
        ]);

        const tracks: Track[] = tracksRes.data || [];
        const playlists: Playlist[] = (playlistsRes.data || []) as Playlist[];

        const artistMap = new Map<string, Track[]>();
        (artistRes.data || []).forEach((track: Track) => {
          const existing = artistMap.get(track.artist) || [];
          artistMap.set(track.artist, [...existing, track]);
        });

        const artistGroups: ArtistGroup[] = Array.from(
          artistMap.entries()
        )
          .map(([artist, tracks]) => ({
            artist,
            tracks: tracks.sort((a, b) => a.title.localeCompare(b.title)),
          }))
          .sort((a, b) => a.artist.localeCompare(b.artist));

        setResults({ tracks, playlists, artistGroups });

        // Suggestions = combination of titles/artists
        const suggSet = new Set<string>();
        tracks.forEach((t) => {
          suggSet.add(t.title);
          suggSet.add(t.artist);
        });
        playlists.forEach((p) => suggSet.add(p.title));
        artistGroups.forEach((g) => suggSet.add(g.artist));
        suggSet.delete("");
        setSuggestions(Array.from(suggSet).slice(0, 10));

        saveHistory(debouncedSearch);

        // Ako nema lokalnih rezultata → automatski YouTube search (user je kucao query, pa je OK)
        if (
          tracks.length === 0 &&
          playlists.length === 0 &&
          artistGroups.length === 0 &&
          ytApiKey
        ) {
          await runYoutubeSearch(debouncedSearch, setYtResults, setYtError);
        }
      } catch (err) {
        console.error("Supabase search error:", err);
        setResults({ tracks: [], playlists: [], artistGroups: [] });
      } finally {
        setIsLoadingSupabase(false);
      }
    };

    runSupabaseSearch();
  }, [debouncedSearch]);

  // ===== YouTube search (manual button) =====

  const handleManualYoutubeSearch = async () => {
    if (!debouncedSearch || !ytApiKey) return;
    setYtResults([]);
    setYtError(null);
    setIsLoadingYoutube(true);
    try {
      await runYoutubeSearch(debouncedSearch, setYtResults, setYtError);
    } finally {
      setIsLoadingYoutube(false);
    }
  };

  // ===== YouTube search: C1 verzija (čisto Data API, bez trikova) =====

  const runYoutubeSearch = async (
    query: string,
    setItems: (items: YoutubeSearchItem[]) => void,
    setError: (err: string | null) => void
  ) => {
    if (!ytApiKey) {
      setError("YouTube API key not configured.");
      return;
    }

    try {
      const baseParams: Record<string, string> = {
        key: ytApiKey,
        part: "snippet",
        maxResults: "10",
        q: query,
        relevanceLanguage: "en", // možeš kasnije da vežeš za language kontekst
        regionCode: "US",         // ili npr. korisnikov region
        safeSearch: "none",
      };

      const buildUrl = (extra: Record<string, string>) =>
        `https://www.googleapis.com/youtube/v3/search?${new URLSearchParams({
          ...baseParams,
          ...extra,
        }).toString()}`;

      // Radimo 2 zvanična poziva: jedan za video, drugi za playliste
      const [videosRes, playlistsRes] = await Promise.all([
        fetch(buildUrl({ type: "video" })),
        fetch(buildUrl({ type: "playlist" })),
      ]);

      if (!videosRes.ok) {
        console.error("YouTube video search error:", await videosRes.text());
      }
      if (!playlistsRes.ok) {
        console.error(
          "YouTube playlist search error:",
          await playlistsRes.text()
        );
      }

      const videosJson = videosRes.ok ? await videosRes.json() : { items: [] };
      const playlistsJson = playlistsRes.ok
        ? await playlistsRes.json()
        : { items: [] };

      const allItems = [...(videosJson.items || []), ...(playlistsJson.items || [])];

      const items: YoutubeSearchItem[] = allItems
        .map((item: any) => {
          if (item.id.kind === "youtube#video") {
            return {
              id: item.id.videoId as string,
              type: "video" as const,
              title: item.snippet.title as string,
              channelTitle: item.snippet.channelTitle as string,
              thumbnailUrl:
                item.snippet.thumbnails?.high?.url ||
                item.snippet.thumbnails?.medium?.url ||
                item.snippet.thumbnails?.default?.url ||
                null,
            };
          }
          if (item.id.kind === "youtube#playlist") {
            return {
              id: item.id.playlistId as string,
              type: "playlist" as const,
              title: item.snippet.title as string,
              channelTitle: item.snippet.channelTitle as string,
              thumbnailUrl:
                item.snippet.thumbnails?.high?.url ||
                item.snippet.thumbnails?.medium?.url ||
                item.snippet.thumbnails?.default?.url ||
                null,
            };
          }
          return null;
        })
        .filter(Boolean) as YoutubeSearchItem[];

      setItems(items);
      setError(null);
    } catch (err) {
      console.error("YouTube search error:", err);
      setError("YouTube search failed.");
    }
  };

  // ===== Import from YouTube into Supabase =====

  const handleTrackClick = (t: Track) => {
    playTrack(t.external_id, t.title, t.artist, t.id);
  };

  const handlePlaylistClick = (id: string) => {
    navigate(`/playlist/${id}`);
  };

  // YouTube item clicked: decide track vs playlist import
  const handleYoutubeItemClick = async (item: YoutubeSearchItem) => {
    if (!ytApiKey) return;

    if (item.type === "video") {
      await importYoutubeVideoAsTrack(item.id);
    } else {
      await importYoutubePlaylistShell(item.id);
    }
  };

  // Import a single YouTube video as a track in Supabase and play it
  const importYoutubeVideoAsTrack = async (videoId: string) => {
    try {
      // 1) Check if we already have this track
      const existing = await externalSupabase
        .from("tracks")
        .select("id, external_id, title, artist, cover_url, duration")
        .eq("external_id", videoId)
        .eq("source", "youtube")
        .maybeSingle<Track>();

      if (existing.data) {
        handleTrackClick(existing.data);
        return;
      }

      // 2) Fetch metadata from YouTube (official Data API)
      const params = new URLSearchParams({
        key: ytApiKey!,
        part: "snippet,contentDetails",
        id: videoId,
        fields:
          "items(id,snippet(title,channelTitle,thumbnails(high(url),medium(url),default(url))),contentDetails(duration))",
      });

      const res = await fetch(
        `https://www.googleapis.com/youtube/v3/videos?${params.toString()}`
      );
      if (!res.ok) {
        console.error("YouTube videos.list error", await res.text());
        return;
      }
      const data = await res.json();
      const video = data.items?.[0];
      if (!video) return;

      const title: string = video.snippet.title;
      const artist: string = video.snippet.channelTitle;
      const thumb =
        video.snippet.thumbnails?.high?.url ||
        video.snippet.thumbnails?.medium?.url ||
        video.snippet.thumbnails?.default?.url ||
        null;
      const durationSeconds = parseYoutubeDuration(
        video.contentDetails?.duration
      );

      // 3) Insert (or upsert) into Supabase
      const { data: inserted, error } = await externalSupabase
        .from("tracks")
        .upsert(
          {
            source: "youtube",
            external_id: videoId,
            title,
            artist,
            cover_url: thumb,
            duration: durationSeconds,
          },
          { onConflict: "external_id" }
        )
        .select("id, external_id, title, artist, cover_url, duration")
        .maybeSingle<Track>();

      if (error) {
        console.error("Supabase track upsert error", error);
        return;
      }
      if (!inserted) return;

      // 4) Play the newly imported track
      handleTrackClick(inserted);
    } catch (err) {
      console.error("importYoutubeVideoAsTrack error:", err);
    }
  };

  // Import YouTube playlist "shell" into Supabase and navigate to it
  const importYoutubePlaylistShell = async (playlistId: string) => {
    try {
      // Check if exists
      const existing = await externalSupabase
        .from("playlists")
        .select("id, title, cover_url, description, external_id")
        .eq("external_id", playlistId)
        .maybeSingle<Playlist & { external_id: string }>();

      if (existing.data) {
        handlePlaylistClick(existing.data.id);
        return;
      }

      const params = new URLSearchParams({
        key: ytApiKey!,
        part: "snippet,contentDetails",
        id: playlistId,
        fields:
          "items(id,snippet(title,description,thumbnails(high(url),medium(url),default(url))))",
      });

      const res = await fetch(
        `https://www.googleapis.com/youtube/v3/playlists?${params.toString()}`
      );
      if (!res.ok) {
        console.error("YouTube playlists.list error", await res.text());
        return;
      }
      const data = await res.json();
      const pl = data.items?.[0];
      if (!pl) return;

      const title: string = pl.snippet.title;
      const description: string | null = pl.snippet.description || null;
      const thumb =
        pl.snippet.thumbnails?.high?.url ||
        pl.snippet.thumbnails?.medium?.url ||
        pl.snippet.thumbnails?.default?.url ||
        null;

      const { data: inserted, error } = await externalSupabase
        .from("playlists")
        .upsert(
          {
            external_id: playlistId,
            title,
            description,
            cover_url: thumb,
            is_public: true,
          },
          { onConflict: "external_id" }
        )
        .select("id, title, cover_url, description")
        .maybeSingle<Playlist>();

      if (error) {
        console.error("Supabase playlist upsert error", error);
        return;
      }
      if (!inserted) return;

      handlePlaylistClick(inserted.id);
    } catch (err) {
      console.error("importYoutubePlaylistShell error:", err);
    }
  };

  // ===== UI helpers =====

  const handleSuggestionClick = (term: string) => {
    setSearchTerm(term);
  };

  const browseCategories = useMemo(
    () => [
      { id: 1, title: t("genre_pop"), color: "from-pink-500 to-purple-500" },
      { id: 2, title: t("genre_rock"), color: "from-red-500 to-orange-500" },
      { id: 3, title: t("genre_hiphop"), color: "from-yellow-500 to-green-500" },
      { id: 4, title: t("genre_electronic"), color: "from-blue-500 to-cyan-500" },
      { id: 5, title: t("genre_jazz"), color: "from-indigo-500 to-purple-500" },
      { id: 6, title: t("genre_classical"), color: "from-gray-500 to-slate-500" },
      { id: 7, title: t("genre_rnb"), color: "from-rose-500 to-pink-500" },
      { id: 8, title: t("genre_country"), color: "from-amber-500 to-yellow-500" },
    ],
    [t]
  );

  const highlightMatch = (text: string, query: string) => {
    if (!query) return text;
    const reg = new RegExp(`(${query})`, "gi");
    return text.replace(reg, "<mark>$1</mark>");
  };

  const showEmptyLocalState =
    debouncedSearch.length > 0 &&
    !isLoadingSupabase &&
    !hasLocalResults;

  return (
    <div className="relative flex-1 overflow-y-auto pb-32">
      <div className="p-4 md:p-8 max-w-4xl mx-auto">
        {/* SEARCH INPUT */}
        <div className="relative mb-8">
          <SearchIcon className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-muted-foreground" />

          <Input
            type="text"
            placeholder={t("search_placeholder")}
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="pl-12 h-12 bg-card border-border text-foreground placeholder:text-muted-foreground"
            autoFocus={isAuthenticated}
            disabled={!isAuthenticated}
            readOnly={!isAuthenticated}
            aria-disabled={!isAuthenticated}
          />

          {/* Autocomplete dropdown (history + suggestions) */}
          {isAuthenticated &&
            searchTerm.length > 0 &&
            (history.length > 0 || autocompleteSuggestions.length > 0) && (
              <div className="absolute z-50 mt-2 w-full bg-card border border-border rounded-lg shadow-lg max-h-80 overflow-y-auto animate-fade-in">
                {history.length > 0 && (
                  <>
                    <h4 className="px-3 pt-3 pb-1 text-xs text-muted-foreground uppercase flex items-center gap-2">
                      <History className="w-4 h-4" /> {t("recent_searches")}
                    </h4>
                    {history.map((h) => (
                      <button
                        key={h}
                        type="button"
                        onClick={() => handleSuggestionClick(h)}
                        className="w-full text-left px-3 py-2 text-sm cursor-pointer hover:bg_WHITE/5"
                      >
                        {h}
                      </button>
                    ))}
                  </>
                )}

                {autocompleteSuggestions.length > 0 && (
                  <>
                    <h4 className="px-3 pt-3 pb-1 text-xs text-muted-foreground uppercase flex items-center gap-2">
                      <SearchIcon className="w-4 h-4" /> {t("suggestions")}
                    </h4>
                    {autocompleteSuggestions.map((s) => (
                      <button
                        key={s}
                        type="button"
                        onClick={() => handleSuggestionClick(s)}
                        className="w-full text-left px-3 py-2 text-sm cursor-pointer hover:bg-white/5"
                        dangerouslySetInnerHTML={{
                          __html: highlightMatch(s, searchTerm),
                        }}
                      />
                    ))}
                  </>
                )}
              </div>
            )}
        </div>

        {/* Filter tabs for local results */}
        {debouncedSearch.length > 0 && hasLocalResults && (
          <div className="mb-6 flex gap-2">
            <button
              onClick={() => setActiveTab("playlists")}
              className={`flex-1 px-3 py-2 rounded-lg font-medium text-sm transition-all duration-200 ${
                activeTab === "playlists"
                  ? "border-2 border-yellow-500 text-yellow-500 bg-yellow-500/10"
                  : "border-2 border-yellow-600/40 text-yellow-600/70 hover:border-yellow-500/60 hover:text-yellow-500/90"
              }`}
            >
              <span className="flex items-center justify-center gap-1.5">
                <ListMusic className="w-4 h-4" />
                <span className="hidden xs:inline">Playlists</span>
                <span className="xs:hidden">Lists</span>
              </span>
            </button>

            <button
              onClick={() => setActiveTab("songs")}
              className={`flex-1 px-3 py-2 rounded-lg font-medium text-sm transition-all duration-200 ${
                activeTab === "songs"
                  ? "border-2 border-yellow-500 text-yellow-500 bg-yellow-500/10"
                  : "border-2 border-yellow-600/40 text-yellow-600/70 hover:border-yellow-500/60 hover:text-yellow-500/90"
              }`}
            >
              <span className="flex items-center justify-center gap-1.5">
                <Music className="w-4 h-4" />
                Songs
              </span>
            </button>

            <button
              onClick={() => setActiveTab("artists")}
              className={`flex-1 px-3 py-2 rounded-lg font-medium text-sm transition-all duration-200 ${
                activeTab === "artists"
                  ? "border-2 border-yellow-500 text-yellow-500 bg-yellow-500/10"
                  : "border-2 border-yellow-600/40 text-yellow-600/70 hover:border-yellow-500/60 hover:text-yellow-500/90"
              }`}
            >
              <span className="flex items-center justify-center gap-1.5">
                <User className="w-4 h-4" />
                Artists
              </span>
            </button>
          </div>
        )}

        {/* Loading states */}
        {isLoadingSupabase && (
          <p className="text-muted-foreground mb-4">
            {t("search_loading")}...
          </p>
        )}

        {/* LOCAL RESULTS */}
        {!isLoadingSupabase && debouncedSearch && hasLocalResults && (
          <div className="space-y-10 animate-fade-in">
            {/* PLAYLISTS */}
            {activeTab === "playlists" && results.playlists.length > 0 && (
              <section>
                <div className="flex items-center gap-2 mb-3">
                  <ListMusic className="w-5 h-5 text-primary" />
                  <h2 className="text-xl font-bold text-foreground">
                    {`${t("search_section_playlists")} (${results.playlists.length})`}
                  </h2>
                </div>
                <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
                  {results.playlists.map((p) => (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => handlePlaylistClick(p.id)}
                      className="cursor-pointer group text-left"
                    >
                      <div className="aspect-square rounded-lg overflow-hidden bg-card mb-2 transition-transform group-hover:scale-105">
                        {p.cover_url ? (
                          <img
                            src={p.cover_url}
                            alt={p.title}
                            className="w-full h-full object-cover"
                            onError={(e) => {
                              (e.target as HTMLImageElement).src =
                                "/placeholder.svg";
                            }}
                          />
                        ) : (
                          <div className="w-full h-full flex items-center justify-center bg-muted">
                            <ListMusic className="w-8 h-8 text-muted-foreground" />
                          </div>
                        )}
                      </div>
                      <h3 className="text-sm font-medium line-clamp-2 text-foreground">
                        {p.title}
                      </h3>
                      {p.description && (
                        <p className="text-xs text-muted-foreground line-clamp-1">
                          {p.description}
                        </p>
                      )}
                    </button>
                  ))}
                </div>
              </section>
            )}

            {/* SONGS */}
            {activeTab === "songs" && results.tracks.length > 0 && (
              <section>
                <div className="flex items-center gap-2 mb-3">
                  <Music className="w-5 h-5 text-primary" />
                  <h2 className="text-xl font-bold text-foreground">
                    {`${t("search_section_songs")} (${results.tracks.length})`}
                  </h2>
                </div>
                <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
                  {results.tracks.map((tTrack) => (
                    <button
                      key={tTrack.id}
                      type="button"
                      onClick={() => handleTrackClick(tTrack)}
                      className="cursor-pointer group text-left"
                    >
                      <div className="aspect-square rounded-lg overflow-hidden bg-card mb-2 transition-transform group-hover:scale-105">
                        {tTrack.cover_url ? (
                          <img
                            src={tTrack.cover_url}
                            alt={tTrack.title}
                            className="w-full h-full object-cover"
                            onError={(e) => {
                              (e.target as HTMLImageElement).src =
                                "/placeholder.svg";
                            }}
                          />
                        ) : (
                          <div className="w-full h-full flex items-center justify-center bg-muted">
                            <Music className="w-8 h-8 text-muted-foreground" />
                          </div>
                        )}
                      </div>
                      <h3 className="text-sm font-medium line-clamp-1 text-foreground">
                        {tTrack.title}
                      </h3>
                      <p className="text-xs text-muted-foreground line-clamp-1">
                        {tTrack.artist}
                      </p>
                      {tTrack.duration && (
                        <p className="text-xs text-muted-foreground flex items-center gap-1 mt-1">
                          <Clock className="w-3 h-3" />
                          {formatDuration(tTrack.duration)}
                        </p>
                      )}
                    </button>
                  ))}
                </div>
              </section>
            )}

            {/* ARTISTS */}
            {activeTab === "artists" && results.artistGroups.length > 0 && (
              <section>
                <div className="flex items-center gap-2 mb-3">
                  <User className="w-5 h-5 text-primary" />
                  <h2 className="text-xl font-bold text-foreground">
                    {`${t("search_section_artists")} (${results.artistGroups.length})`}
                  </h2>
                </div>

                <div className="space-y-6">
                  {results.artistGroups.map((group) => (
                    <div key={group.artist} className="space-y-2">
                      <h3 className="text-lg font-semibold text-muted-foreground px-1">
                        {group.artist}
                      </h3>
                      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
                        {group.tracks.map((track) => (
                          <button
                            key={track.id}
                            type="button"
                            onClick={() => handleTrackClick(track)}
                            className="cursor-pointer group text-left"
                          >
                            <div className="aspect-square rounded-lg overflow-hidden bg-card mb-2 transition-transform group-hover:scale-105">
                              {track.cover_url ? (
                                <img
                                  src={track.cover_url}
                                  alt={track.title}
                                  className="w-full h-full object-cover"
                                  onError={(e) => {
                                    (e.target as HTMLImageElement).src =
                                      "/placeholder.svg";
                                  }}
                                />
                              ) : (
                                <div className="w-full h-full flex items-center justify-center bg-muted">
                                  <Music className="w-8 h-8 text-muted-foreground" />
                                </div>
                              )}
                            </div>
                            <h4 className="text-sm font-medium line-clamp-1 text-foreground">
                              {track.title}
                            </h4>
                            {track.duration && (
                              <p className="text-xs text-muted-foreground flex items-center gap-1 mt-1">
                                <Clock className="w-3 h-3" />
                                {formatDuration(track.duration)}
                              </p>
                            )}
                          </button>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </section>
            )}
          </div>
        )}

        {/* NO LOCAL RESULTS → OFFER / SHOW YOUTUBE SEARCH */}
        {showEmptyLocalState && (
          <div className="mt-8 space-y-4">
            <p className="text-muted-foreground">
              {t("search_no_results").replace("{query}", debouncedSearch)}
            </p>

            {ytApiKey ? (
              <button
                type="button"
                onClick={handleManualYoutubeSearch}
                className="inline-flex items-center gap-2 px-4 py-2 rounded-lg border border-red-500 text-red-400 hover:bg-red-500/10 transition-colors"
              >
                <Youtube className="w-4 h-4" />
                {t("search_on_youtube") || "Search on YouTube"}
              </button>
            ) : (
              <p className="text-xs text-muted-foreground">
                YouTube search is not configured (missing VITE_YOUTUBE_API_KEY).
              </p>
            )}
          </div>
        )}

        {/* YOUTUBE RESULTS */}
        {(hasYtResults || isLoadingYoutube || ytError) && debouncedSearch && (
          <section className="mt-10 animate-fade-in">
            <div className="flex items-center gap-2 mb-3">
              <Youtube className="w-5 h-5 text-red-500" />
              <h2 className="text-xl font-bold text-foreground">
                YouTube
              </h2>
            </div>

            {isLoadingYoutube && (
              <p className="text-muted-foreground">
                {t("search_loading")} YouTube...
              </p>
            )}

            {ytError && (
              <p className="text-red-400 text-sm">{ytError}</p>
            )}

            {hasYtResults && (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                {ytResults.map((item) => (
                  <button
                    key={`${item.type}-${item.id}`}
                    type="button"
                    onClick={() => handleYoutubeItemClick(item)}
                    className="group text-left cursor-pointer rounded-lg bg-card/60 hover:bg-card transition-colors overflow-hidden border border-border/60"
                  >
                    <div className="aspect-video w-full overflow-hidden">
                      {item.thumbnailUrl ? (
                        <img
                          src={item.thumbnailUrl}
                          alt={item.title}
                          className="w-full h-full object-cover group-hover:scale-105 transition-transform"
                          onError={(e) => {
                            (e.target as HTMLImageElement).src =
                              "/placeholder.svg";
                          }}
                        />
                      ) : (
                        <div className="w-full h-full flex items-center justify-center bg-muted">
                          <Youtube className="w-10 h-10 text-red-500/70" />
                        </div>
                      )}
                    </div>
                    <div className="p-3 space-y-1">
                      <p className="text-xs uppercase text-red-400 flex items-center gap-1">
                        <Youtube className="w-3 h-3" />
                        {item.type === "video" ? "YouTube Video" : "YouTube Playlist"}
                      </p>
                      <h3 className="text-sm font-semibold line-clamp-2 text-foreground">
                        {item.title}
                      </h3>
                      <p className="text-xs text-muted-foreground line-clamp-1">
                        {item.channelTitle}
                      </p>
                    </div>
                  </button>
                ))}
              </div>
            )}

            {hasYtResults && (
              <p className="mt-3 text-xs text-muted-foreground">
                Clicking a YouTube result will legally import its metadata into
                Purple Music (tracks/playlists) and play it through the official
                YouTube IFrame player.
              </p>
            )}
          </section>
        )}

        {/* DEFAULT BROWSE (NO SEARCH) */}
        {!debouncedSearch && (
          <div className="mt-8 animate-fade-in">
            <h2 className="text-2xl font-bold mb-4 text-foreground">
              {t("browse_all")}
            </h2>
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

      {!isAuthenticated && (
        <div className="pointer-events-none fixed inset-0 z-[9998] flex items-start justify-center">
          <div className="mt-24 px-4 py-3 rounded-xl blocked-search-page-msg bg-black/85 text-[16px] text-[var(--pm-gold)] shadow-2xl backdrop-blur">
            {t("login_to_search")}
          </div>
        </div>
      )}
    </div>
  );
};

export default Search;
