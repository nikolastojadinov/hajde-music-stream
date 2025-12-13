import { useState, useEffect } from "react";
import { Search as SearchIcon, Music, ListMusic } from "lucide-react";
import { Input } from "@/components/ui/input";
import { useNavigate } from "react-router-dom";
import { usePlayer } from "@/contexts/PlayerContext";
import { externalSupabase } from "@/lib/externalSupabase";

// ================= TYPES =================

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
}

interface YoutubeItem {
  id: string;
  type: "video" | "playlist";
  title: string;
  channelTitle: string;
  thumbnail: string | null;
}

// ================= CONFIG =================

const SONG_LIMIT = 10;
const ytApiKey = import.meta.env.VITE_YOUTUBE_API_KEY as string | undefined;

// ================= COMPONENT =================

export default function Search() {
  const navigate = useNavigate();
  const { playTrack } = usePlayer();

  const [query, setQuery] = useState("");
  const [debounced, setDebounced] = useState("");

  const [songs, setSongs] = useState<Track[]>([]);
  const [playlists, setPlaylists] = useState<Playlist[]>([]);
  const [ytSongs, setYtSongs] = useState<YoutubeItem[]>([]);
  const [ytPlaylists, setYtPlaylists] = useState<YoutubeItem[]>([]);

  const [loading, setLoading] = useState(false);

  // ================= DEBOUNCE =================

  useEffect(() => {
    const t = setTimeout(() => setDebounced(query.trim()), 400);
    return () => clearTimeout(t);
  }, [query]);

  // ================= SEARCH =================

  useEffect(() => {
    if (!debounced) {
      setSongs([]);
      setPlaylists([]);
      setYtSongs([]);
      setYtPlaylists([]);
      return;
    }

    runSearch(debounced);
  }, [debounced]);

  // ================= CORE LOGIC =================

  const runSearch = async (q: string) => {
    setLoading(true);

    try {
      // ---------- LOCAL SONGS ----------
      const { data: localTracks } = await externalSupabase
        .from("tracks")
        .select("id, external_id, title, artist, cover_url, duration")
        .or(`title.ilike.%${q}%,artist.ilike.%${q}%`)
        .limit(SONG_LIMIT);

      const safeLocalTracks = localTracks || [];
      setSongs(safeLocalTracks);

      // ---------- LOCAL PLAYLISTS ----------
      const { data: localPlaylists } = await externalSupabase
        .from("playlists")
        .select("id, title, cover_url")
        .ilike("title", `%${q}%`);

      setPlaylists(localPlaylists || []);

      // ---------- YOUTUBE ----------
      if (ytApiKey) {
        await runYoutubeSearch(q, safeLocalTracks.length);
      }
    } finally {
      setLoading(false);
    }
  };

  // ================= YOUTUBE SEARCH =================

  const runYoutubeSearch = async (q: string, localSongCount: number) => {
    const baseParams = {
      key: ytApiKey!,
      part: "snippet",
      q,
      safeSearch: "none",
      maxResults: "20",
    };

    // ---------- SONGS (MUSIC VIDEOS ONLY) ----------
    if (localSongCount < SONG_LIMIT) {
      const res = await fetch(
        `https://www.googleapis.com/youtube/v3/search?${new URLSearchParams({
          ...baseParams,
          type: "video",
          videoCategoryId: "10",
        })}`
      );

      const json = await res.json();

      setYtSongs(
        (json.items || [])
          .filter((i: any) =>
            !/interview|reaction|cover|shorts/i.test(i.snippet.title)
          )
          .slice(0, SONG_LIMIT)
          .map((i: any) => ({
            id: i.id.videoId,
            type: "video",
            title: i.snippet.title,
            channelTitle: i.snippet.channelTitle,
            thumbnail:
              i.snippet.thumbnails?.medium?.url ||
              i.snippet.thumbnails?.default?.url ||
              null,
          }))
      );
    } else {
      setYtSongs([]);
    }

    // ---------- PLAYLISTS ----------
    const plRes = await fetch(
      `https://www.googleapis.com/youtube/v3/search?${new URLSearchParams({
        ...baseParams,
        type: "playlist",
        maxResults: "50",
      })}`
    );

    const plJson = await plRes.json();

    setYtPlaylists(
      (plJson.items || []).map((i: any) => ({
        id: i.id.playlistId,
        type: "playlist",
        title: i.snippet.title,
        channelTitle: i.snippet.channelTitle,
        thumbnail:
          i.snippet.thumbnails?.medium?.url ||
          i.snippet.thumbnails?.default?.url ||
          null,
      }))
    );
  };

  // ================= ACTIONS =================

  const handlePlay = (t: Track) => {
    playTrack(t.external_id, t.title, t.artist, t.id);
  };

  const handleImportVideo = async (yt: YoutubeItem) => {
    const { data: existing } = await externalSupabase
      .from("tracks")
      .select("id")
      .eq("external_id", yt.id)
      .maybeSingle();

    if (existing) return;

    // import logic already exists elsewhere
  };

  const handlePlaylistOpen = (id: string) => {
    navigate(`/playlist/${id}`);
  };

  // ================= RENDER =================

  return (
    <div className="p-4 max-w-4xl mx-auto pb-32">
      {/* SEARCH INPUT */}
      <div className="relative mb-6">
        <SearchIcon className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-muted-foreground" />
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search songs or playlists"
          className="pl-12 h-12"
        />
      </div>

      {loading && <p className="text-muted-foreground">Searching…</p>}

      {/* SONGS */}
      {(songs.length > 0 || ytSongs.length > 0) && (
        <section className="mb-10">
          <h2 className="flex items-center gap-2 text-xl font-bold mb-4">
            <Music /> Songs
          </h2>

          {songs.map((s) => (
            <button
              key={s.id}
              onClick={() => handlePlay(s)}
              className="block w-full text-left py-2 border-b border-border"
            >
              <div className="font-medium">{s.title}</div>
              <div className="text-sm text-muted-foreground">{s.artist}</div>
            </button>
          ))}

          {ytSongs.map((y) => (
            <div
              key={y.id}
              className="flex justify-between items-center py-2 border-b border-border"
            >
              <div>
                <div className="font-medium">{y.title}</div>
                <div className="text-sm text-muted-foreground">
                  {y.channelTitle}
                </div>
              </div>
              <button
                onClick={() => handleImportVideo(y)}
                className="px-3 py-1 border rounded"
              >
                Import
              </button>
            </div>
          ))}
        </section>
      )}

      {/* PLAYLISTS */}
      {(playlists.length > 0 || ytPlaylists.length > 0) && (
        <section>
          <h2 className="flex items-center gap-2 text-xl font-bold mb-4">
            <ListMusic /> Playlists
          </h2>

          {playlists.map((p) => (
            <button
              key={p.id}
              onClick={() => handlePlaylistOpen(p.id)}
              className="block w-full text-left py-2 border-b border-border"
            >
              {p.title}
            </button>
          ))}

          {ytPlaylists.map((y) => (
            <div
              key={y.id}
              className="flex items-center gap-3 py-2 border-b border-border"
            >
              {y.thumbnail && (
                <img src={y.thumbnail} className="w-20 rounded" />
              )}
              <div>
                <div className="font-medium">{y.title}</div>
                <div className="text-sm text-muted-foreground">
                  {y.channelTitle}
                </div>
              </div>
            </div>
          ))}
        </section>
      )}
    </div>
  );
}
