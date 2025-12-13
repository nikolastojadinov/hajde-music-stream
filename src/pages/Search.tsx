import { useState, useEffect, useMemo } from "react";
import {
  Search as SearchIcon,
  Music,
  ListMusic,
  User,
  Youtube,
  Clock,
} from "lucide-react";
import { Input } from "@/components/ui/input";
import { useLanguage } from "@/contexts/LanguageContext";
import { useNavigate } from "react-router-dom";
import { usePlayer } from "@/contexts/PlayerContext";
import { usePi } from "@/contexts/PiContext";
import { externalSupabase } from "@/lib/externalSupabase";

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

  const [isLoadingSupabase, setIsLoadingSupabase] = useState(false);
  const [isLoadingYoutube, setIsLoadingYoutube] = useState(false);
  const [ytResults, setYtResults] = useState<YoutubeSearchItem[]>([]);
  const [ytError, setYtError] = useState<string | null>(null);

  const hasLocalResults =
    results.tracks.length > 0 ||
    results.playlists.length > 0 ||
    results.artistGroups.length > 0;

  const hasYtResults = ytResults.length > 0;

  // ===== Debounce input =====
  useEffect(() => {
    const timer = setTimeout(
      () => setDebouncedSearch(searchTerm.trim()),
      350
    );
    return () => clearTimeout(timer);
  }, [searchTerm]);

  useEffect(() => {
    if (searchTerm.length > 0) {
      setActiveTab("playlists");
    }
  }, [searchTerm]);

  // ===== Supabase search =====
  useEffect(() => {
    if (!debouncedSearch) {
      setResults({ tracks: [], playlists: [], artistGroups: [] });
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
        const playlists: Playlist[] = playlistsRes.data || [];

        const artistMap = new Map<string, Track[]>();
        (artistRes.data || []).forEach((track: Track) => {
          const list = artistMap.get(track.artist) || [];
          artistMap.set(track.artist, [...list, track]);
        });

        const artistGroups: ArtistGroup[] = Array.from(artistMap.entries())
          .map(([artist, tracks]) => ({
            artist,
            tracks: tracks.sort((a, b) => a.title.localeCompare(b.title)),
          }))
          .sort((a, b) => a.artist.localeCompare(b.artist));

        setResults({ tracks, playlists, artistGroups });

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

  // ===== YouTube search =====

  const runYoutubeSearch = async (
    query: string,
    setItems: (items: YoutubeSearchItem[]) => void,
    setError: (err: string | null) => void
  ) => {
    if (!ytApiKey) return;

    try {
      const baseParams = {
        key: ytApiKey,
        part: "snippet",
        maxResults: "10",
        q: query,
        safeSearch: "none",
      };

      const buildUrl = (extra: Record<string, string>) =>
        `https://www.googleapis.com/youtube/v3/search?${new URLSearchParams({
          ...baseParams,
          ...extra,
        }).toString()}`;

      const [videosRes, playlistsRes] = await Promise.all([
        fetch(buildUrl({ type: "video" })),
        fetch(buildUrl({ type: "playlist" })),
      ]);

      const videosJson = videosRes.ok ? await videosRes.json() : { items: [] };
      const playlistsJson = playlistsRes.ok ? await playlistsRes.json() : { items: [] };

      const items: YoutubeSearchItem[] = [...videosJson.items, ...playlistsJson.items]
        .map((item: any) => {
          if (item.id.kind === "youtube#video") {
            return {
              id: item.id.videoId,
              type: "video",
              title: item.snippet.title,
              channelTitle: item.snippet.channelTitle,
              thumbnailUrl: item.snippet.thumbnails?.high?.url || null,
            };
          }
          if (item.id.kind === "youtube#playlist") {
            return {
              id: item.id.playlistId,
              type: "playlist",
              title: item.snippet.title,
              channelTitle: item.snippet.channelTitle,
              thumbnailUrl: item.snippet.thumbnails?.high?.url || null,
            };
          }
          return null;
        })
        .filter(Boolean);

      setItems(items);
      setError(null);
    } catch (err) {
      console.error("YouTube search error:", err);
      setError("YouTube search failed.");
    }
  };

  // ===== UI helpers =====

  const handleTrackClick = (t: Track) => {
    playTrack(t.external_id, t.title, t.artist, t.id);
  };

  const handlePlaylistClick = (id: string) => {
    navigate(`/playlist/${id}`);
  };

  const browseCategories = useMemo(
    () => [
      { id: 1, title: t("genre_pop"), color: "from-pink-500 to-purple-500" },
      { id: 2, title: t("genre_rock"), color: "from-red-500 to-orange-500" },
      { id: 3, title: t("genre_hiphop"), color: "from-yellow-500 to-green-500" },
      { id: 4, title: t("genre_electronic"), color: "from-blue-500 to-cyan-500" },
    ],
    [t]
  );

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
            className="pl-12 h-12 bg-card border-border"
            autoFocus={isAuthenticated}
            disabled={!isAuthenticated}
            readOnly={!isAuthenticated}
          />
        </div>

        {/* RESULTS */}
        {isLoadingSupabase && (
          <p className="text-muted-foreground">{t("search_loading")}...</p>
        )}

        {!isLoadingSupabase && debouncedSearch && hasLocalResults && (
          <div className="space-y-10">
            {/* Playlists */}
            {activeTab === "playlists" && results.playlists.length > 0 && (
              <section>
                <h2 className="text-xl font-bold mb-3">Playlists</h2>
                <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                  {results.playlists.map((p) => (
                    <button key={p.id} onClick={() => handlePlaylistClick(p.id)}>
                      <p className="text-sm">{p.title}</p>
                    </button>
                  ))}
                </div>
              </section>
            )}

            {/* Songs */}
            {activeTab === "songs" && results.tracks.length > 0 && (
              <section>
                <h2 className="text-xl font-bold mb-3">Songs</h2>
                {results.tracks.map((t) => (
                  <button key={t.id} onClick={() => handleTrackClick(t)}>
                    {t.title} – {t.artist}
                  </button>
                ))}
              </section>
            )}

            {/* Artists */}
            {activeTab === "artists" && results.artistGroups.length > 0 && (
              <section>
                <h2 className="text-xl font-bold mb-3">Artists</h2>
                {results.artistGroups.map((g) => (
                  <div key={g.artist}>
                    <h3 className="font-semibold">{g.artist}</h3>
                  </div>
                ))}
              </section>
            )}
          </div>
        )}

        {!debouncedSearch && (
          <div className="mt-8">
            <h2 className="text-2xl font-bold mb-4">{t("browse_all")}</h2>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
              {browseCategories.map((cat) => (
                <div
                  key={cat.id}
                  className={`h-32 rounded-lg bg-gradient-to-br ${cat.color} flex items-center justify-center text-white font-bold`}
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
