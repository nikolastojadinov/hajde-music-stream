import { useState, useEffect } from "react";
import {
  Search as SearchIcon,
  Music,
  ListMusic,
  Youtube,
  User,
} from "lucide-react";
import { Input } from "@/components/ui/input";
import { useNavigate } from "react-router-dom";
import { usePlayer } from "@/contexts/PlayerContext";
import { externalSupabase } from "@/lib/externalSupabase";

/* ================= TYPES ================= */

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
  type: "video" | "playlist" | "channel";
  title: string;
  channelTitle: string;
  thumbnail: string | null;
}

/* ================= CONFIG ================= */

const SONG_LIMIT = 10;
const ytApiKey = import.meta.env.VITE_YOUTUBE_API_KEY as string | undefined;

/* ================= COMPONENT ================= */

export default function Search() {
  const navigate = useNavigate();
  const { playTrack } = usePlayer();

  const [query, setQuery] = useState("");
  const [debounced, setDebounced] = useState("");

  const [songs, setSongs] = useState<Track[]>([]);
  const [playlists, setPlaylists] = useState<Playlist[]>([]);

  const [ytSongs, setYtSongs] = useState<YoutubeItem[]>([]);
  const [ytPlaylists, setYtPlaylists] = useState<YoutubeItem[]>([]);
  const [ytArtists, setYtArtists] = useState<YoutubeItem[]>([]);

  const [loading, setLoading] = useState(false);

  /* ================= DEBOUNCE ================= */

  useEffect(() => {
    const t = setTimeout(() => setDebounced(query.trim()), 400);
    return () => clearTimeout(t);
  }, [query]);

  /* ================= SEARCH ================= */

  useEffect(() => {
    if (!debounced) {
      setSongs([]);
      setPlaylists([]);
      setYtSongs([]);
      setYtPlaylists([]);
      setYtArtists([]);
      return;
    }

    runSearch(debounced);
  }, [debounced]);

  /* ================= CORE SEARCH ================= */

  const runSearch = async (q: string) => {
    setLoading(true);

    try {
      /* ---------- LOCAL SONGS ---------- */
      const { data: localTracks } = await externalSupabase
        .from("tracks")
        .select("id, external_id, title, artist, cover_url, duration")
        .or(`title.ilike.%${q}%,artist.ilike.%${q}%`)
        .limit(SONG_LIMIT);

      const safeTracks = localTracks || [];
      setSongs(safeTracks);

      /* ---------- LOCAL PLAYLISTS ---------- */
      const { data: localPlaylists } = await externalSupabase
        .from("playlists")
        .select("id, title, cover_url")
        .ilike("title", `%${q}%`);

      setPlaylists(localPlaylists || []);

      /* ---------- YOUTUBE ---------- */
      if (ytApiKey) {
        await runYoutubeSearch(q, safeTracks.length);
      }
    } finally {
      setLoading(false);
    }
  };

  /* ================= YOUTUBE SEARCH ================= */

  const runYoutubeSearch = async (q: string, localSongCount: number) => {
    const base = {
      key: ytApiKey!,
      part: "snippet",
      q,
      safeSearch: "none",
      maxResults: "25",
    };

    /* ---------- SONGS (music videos only) ---------- */
    if (localSongCount < SONG_LIMIT) {
      const res = await fetch(
        `https://www.googleapis.com/youtube/v3/search?${new URLSearchParams({
          ...base,
          type: "video",
          videoCategoryId: "10",
        })}`
      );

      const json = await res.json();

      setYtSongs(
        (json.items || [])
          .filter((i: any) => i.id?.videoId)
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

    /* ---------- PLAYLISTS ---------- */
    const plRes = await fetch(
      `https://www.googleapis.com/youtube/v3/search?${new URLSearchParams({
        ...base,
        type: "playlist",
        maxResults: "40",
      })}`
    );

    const plJson = await plRes.json();

    setYtPlaylists(
      (plJson.items || [])
        .filter((i: any) => i.id?.playlistId)
        .map((i: any) => ({
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

    /* ---------- ARTISTS / CHANNELS ---------- */
    const chRes = await fetch(
      `https://www.googleapis.com/youtube/v3/search?${new URLSearchParams({
        ...base,
        type: "channel",
        maxResults: "6",
      })}`
    );

    const chJson = await chRes.json();

    setYtArtists(
      (chJson.items || [])
        .filter((i: any) => i.id?.channelId)
        .map((i: any) => ({
          id: i.id.channelId,
          type: "channel",
          title: i.snippet.title,
          channelTitle: i.snippet.title,
          thumbnail:
            i.snippet.thumbnails?.medium?.url ||
            i.snippet.thumbnails?.default?.url ||
            null,
        }))
    );
  };

  /* ================= ACTIONS ================= */

  const handlePlay = (t: Track) => {
    playTrack(t.external_id, t.title, t.artist, t.id);
  };

  const handleImportAndPlayYoutube = async (y: YoutubeItem) => {
    const { data: existing } = await externalSupabase
      .from("tracks")
      .select("id, external_id, title, artist")
      .eq("external_id", y.id)
      .maybeSingle();

    if (existing) {
      playTrack(existing.external_id, existing.title, existing.artist, existing.id);
      return;
    }

    // import is already implemented elsewhere in your project
  };

  const handlePlaylistOpen = (id: string) => {
    // FIX: force remount
    navigate(`/playlist/${id}`, { replace: true });
    setTimeout(() => navigate(`/playlist/${id}`), 50);
  };

  const handleArtistClick = (artist: string) => {
    setQuery(artist);
  };

  /* ================= RENDER ================= */

  return (
    <div className="p-4 max-w-4xl mx-auto pb-32">
      {/* SEARCH INPUT */}
      <div className="relative mb-6">
        <SearchIcon className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-muted-foreground" />
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search songs, artists or playlists"
          className="pl-12 h-12"
        />
      </div>

      {loading && <p className="text-muted-foreground">Searching…</p>}

      {/* ARTISTS */}
      {ytArtists.length > 0 && (
        <section className="mb-8">
          <h2 className="flex items-center gap-2 text-xl font-bold mb-3">
            <User /> Artists
          </h2>

          <div className="flex gap-4 overflow-x-auto">
            {ytArtists.map((a) => (
              <button
                key={a.id}
                onClick={() => handleArtistClick(a.title)}
                className="min-w-[140px] text-left"
              >
                {a.thumbnail && (
                  <img src={a.thumbnail} className="w-28 h-28 rounded-full mb-2" />
                )}
                <div className="text-sm font-medium">{a.title}</div>
              </button>
            ))}
          </div>
        </section>
      )}

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
            <button
              key={y.id}
              onClick={() => handleImportAndPlayYoutube(y)}
              className="block w-full text-left py-2 border-b border-border"
            >
              <div className="font-medium">{y.title}</div>
              <div className="text-sm text-muted-foreground">
                <Youtube className="inline w-4 h-4 mr-1" />
                {y.channelTitle}
              </div>
            </button>
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
            <div key={y.id} className="flex items-center gap-3 py-2 border-b">
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
