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

      const safeTracks = localTracks || [];
      setSongs(safeTracks);

      // ---------- LOCAL PLAYLISTS ----------
      const { data: localPlaylists } = await externalSupabase
        .from("playlists")
        .select("id, title, cover_url")
        .ilike("title", `%${q}%`);

      setPlaylists(localPlaylists || []);

      // ---------- YOUTUBE ----------
      if (ytApiKey) {
        await runYoutubeSearch(q, safeTracks.length);
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
      maxResults: "25",
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

  const openLocalPlaylist = (id: string) => {
    navigate(`/playlist/${id}`);
  };

  const openYoutubePlaylist = async (yt: YoutubeItem) => {
    if (!ytApiKey) return;

    let playlistId: string;

    // 1) get or create playlist
    const { data: existing } = await externalSupabase
      .from("playlists")
      .select("id")
      .eq("external_id", yt.id)
      .maybeSingle();

    if (existing?.id) {
      playlistId = existing.id;
    } else {
      const { data: inserted, error } = await externalSupabase
        .from("playlists")
        .insert({
          external_id: yt.id,
          title: yt.title,
          cover_url: yt.thumbnail,
          is_public: true,
        })
        .select("id")
        .single();

      if (error || !inserted) {
        console.error("Playlist create failed", error);
        return;
      }

      playlistId = inserted.id;
    }

    // 2) import tracks
    await importYoutubePlaylistTracks(yt.id, playlistId);

    // 3) open playlist page
    navigate(`/playlist/${playlistId}`);
  };

  // ================= IMPORT PLAYLIST TRACKS =================

  const importYoutubePlaylistTracks = async (
    youtubePlaylistId: string,
    playlistId: string
  ) => {
    if (!ytApiKey) return;

    try {
      // 1) fetch playlist items
      const itemsRes = await fetch(
        `https://www.googleapis.com/youtube/v3/playlistItems?${new URLSearchParams({
          key: ytApiKey,
          part: "contentDetails,snippet",
          playlistId: youtubePlaylistId,
          maxResults: "50",
        })}`
      );

      const itemsJson = await itemsRes.json();
      const items = itemsJson.items || [];
      if (!items.length) return;

      const videoIds = items
        .map((i: any) => i.contentDetails?.videoId)
        .filter(Boolean);

      // 2) fetch video metadata
      const videosRes = await fetch(
        `https://www.googleapis.com/youtube/v3/videos?${new URLSearchParams({
          key: ytApiKey,
          part: "snippet,contentDetails",
          id: videoIds.join(","),
        })}`
      );

      const videosJson = await videosRes.json();
      const videos = videosJson.items || [];

      let position = 0;
      let importedCount = 0;

      for (const v of videos) {
        const videoId = v.id;

        // check existing track
        const { data: existingTrack } = await externalSupabase
          .from("tracks")
          .select("id")
          .eq("external_id", videoId)
          .maybeSingle();

        let trackId: string;

        if (existingTrack?.id) {
          trackId = existingTrack.id;
        } else {
          const { data: insertedTrack } = await externalSupabase
            .from("tracks")
            .insert({
              source: "youtube",
              external_id: videoId,
              title: v.snippet.title,
              artist: v.snippet.channelTitle,
              cover_url:
                v.snippet.thumbnails?.high?.url ||
                v.snippet.thumbnails?.medium?.url ||
                null,
            })
            .select("id")
            .single();

          if (!insertedTrack) continue;
          trackId = insertedTrack.id;
        }

        // link track to playlist
        await externalSupabase.from("playlist_tracks").upsert({
          playlist_id: playlistId,
          track_id: trackId,
          position,
        });

        position++;
        importedCount++;
      }

      // update track_count
      await externalSupabase
        .from("playlists")
        .update({ track_count: importedCount })
        .eq("id", playlistId);
    } catch (err) {
      console.error("YouTube playlist import failed", err);
    }
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
            <div key={y.id} className="py-2 border-b border-border">
              <div className="font-medium">{y.title}</div>
              <div className="text-sm text-muted-foreground">
                {y.channelTitle}
              </div>
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
              onClick={() => openLocalPlaylist(p.id)}
              className="block w-full text-left py-2 border-b border-border"
            >
              {p.title}
            </button>
          ))}

          {ytPlaylists.map((y) => (
            <button
              key={y.id}
              onClick={() => openYoutubePlaylist(y)}
              className="flex items-center gap-3 py-2 border-b border-border w-full text-left"
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
            </button>
          ))}
        </section>
      )}
    </div>
  );
}
