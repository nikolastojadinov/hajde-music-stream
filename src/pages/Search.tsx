import { useState, useEffect } from "react";
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

// ================== Types ==================

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

interface YoutubeItem {
  id: string;
  type: "video" | "playlist";
  title: string;
  channelTitle: string;
  thumbnailUrl: string | null;
  alreadyExists: boolean;
}

type Tab = "local" | "youtube";

// ================== Helpers ==================

const ytApiKey = import.meta.env.VITE_YOUTUBE_API_KEY as string | undefined;

const parseYoutubeDuration = (iso?: string | null): number | null => {
  if (!iso) return null;
  const m = iso.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
  if (!m) return null;
  return (
    (parseInt(m[1] || "0") * 3600) +
    (parseInt(m[2] || "0") * 60) +
    parseInt(m[3] || "0")
  );
};

const formatDuration = (sec: number | null) =>
  sec ? `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, "0")}` : "";

// ================== Component ==================

export default function Search() {
  const { t } = useLanguage();
  const { user } = usePi();
  const { playTrack } = usePlayer();
  const navigate = useNavigate();

  const [query, setQuery] = useState("");
  const [tab, setTab] = useState<Tab>("local");

  const [tracks, setTracks] = useState<Track[]>([]);
  const [playlists, setPlaylists] = useState<Playlist[]>([]);
  const [artists, setArtists] = useState<ArtistGroup[]>([]);

  const [ytItems, setYtItems] = useState<YoutubeItem[]>([]);
  const [loading, setLoading] = useState(false);

  const hasLocalResults =
    tracks.length || playlists.length || artists.length;

  // ================== Local Search ==================

  useEffect(() => {
    if (!query.trim()) {
      setTracks([]);
      setPlaylists([]);
      setArtists([]);
      return;
    }

    const run = async () => {
      setLoading(true);

      const pattern = `%${query}%`;

      const [tRes, pRes, aRes] = await Promise.all([
        externalSupabase
          .from("tracks")
          .select("id,external_id,title,artist,cover_url,duration")
          .or(`title.ilike.${pattern},artist.ilike.${pattern}`)
          .limit(30),

        externalSupabase
          .from("playlists")
          .select("id,title,cover_url,description")
          .ilike("title", pattern)
          .limit(30),

        externalSupabase
          .from("tracks")
          .select("id,external_id,title,artist,cover_url,duration")
          .ilike("artist", pattern)
          .limit(60),
      ]);

      setTracks(tRes.data || []);
      setPlaylists(pRes.data || []);

      const map = new Map<string, Track[]>();
      (aRes.data || []).forEach((t: Track) => {
        map.set(t.artist, [...(map.get(t.artist) || []), t]);
      });

      setArtists(
        Array.from(map.entries()).map(([artist, tracks]) => ({
          artist,
          tracks,
        }))
      );

      setTab("local");
      setLoading(false);
    };

    run();
  }, [query]);

  // ================== YouTube Search ==================

  const runYoutubeSearch = async () => {
    if (!ytApiKey || !query) return;
    setLoading(true);

    const res = await fetch(
      `https://www.googleapis.com/youtube/v3/search?` +
        new URLSearchParams({
          key: ytApiKey,
          part: "snippet",
          q: query,
          maxResults: "10",
          type: "video,playlist",
        })
    );

    const json = await res.json();
    const items = json.items || [];

    const mapped: YoutubeItem[] = [];

    for (const item of items) {
      const id =
        item.id.videoId || item.id.playlistId;

      const exists = await externalSupabase
        .from("tracks")
        .select("id")
        .eq("external_id", id)
        .maybeSingle();

      mapped.push({
        id,
        type: item.id.videoId ? "video" : "playlist",
        title: item.snippet.title,
        channelTitle: item.snippet.channelTitle,
        thumbnailUrl:
          item.snippet.thumbnails?.medium?.url || null,
        alreadyExists: Boolean(exists.data),
      });
    }

    setYtItems(mapped);
    setTab("youtube");
    setLoading(false);
  };

  // ================== UI ==================

  return (
    <div className="p-4 max-w-4xl mx-auto">
      <div className="relative mb-6">
        <SearchIcon className="absolute left-3 top-1/2 -translate-y-1/2" />
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search artists, songs, playlists"
          className="pl-10"
          disabled={!user}
        />
      </div>

      {hasLocalResults && (
        <div className="flex gap-2 mb-6">
          <button onClick={() => setTab("local")}>Purple Music</button>
          <button onClick={() => runYoutubeSearch()}>
            YouTube
          </button>
        </div>
      )}

      {loading && <p>Loading…</p>}

      {tab === "local" && (
        <>
          {artists.map((a) => (
            <div key={a.artist}>
              <h3>{a.artist}</h3>
              {a.tracks.map((t) => (
                <button
                  key={t.id}
                  onClick={() =>
                    playTrack(
                      t.external_id,
                      t.title,
                      t.artist,
                      t.id
                    )
                  }
                >
                  {t.title}
                </button>
              ))}
            </div>
          ))}
        </>
      )}

      {tab === "youtube" && (
        <>
          {ytItems.map((y) => (
            <div key={y.id}>
              <img src={y.thumbnailUrl || ""} />
              <p>{y.title}</p>
              {y.alreadyExists ? (
                <span>✔ Already in library</span>
              ) : (
                <button>Import</button>
              )}
            </div>
          ))}
        </>
      )}
    </div>
  );
}
