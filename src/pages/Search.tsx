import { useEffect, useMemo, useState } from "react";
import {
  Search as SearchIcon,
  Music,
  ListMusic,
  Youtube,
  User,
  ExternalLink,
} from "lucide-react";
import { Input } from "@/components/ui/input";
import { Link, useNavigate } from "react-router-dom";
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

type YoutubeItemType = "video" | "playlist" | "channel";

interface YoutubeItem {
  id: string; // videoId / playlistId / channelId
  type: YoutubeItemType;
  title: string;
  channelTitle: string;
  thumbnail: string | null;
  channelId?: string | null;
}

/* ================= CONFIG ================= */

const SONG_LIMIT = 10;
const YT_PLAYLIST_LIMIT = 40;
const YT_ARTIST_LIMIT = 6;

// cache (best-effort)
const YT_CACHE_TTL_MS = 6 * 60 * 60 * 1000; // 6h

const ytApiKey = import.meta.env.VITE_YOUTUBE_API_KEY as string | undefined;

/* ================= HELPERS ================= */

const encodeArtistKey = (name: string) =>
  encodeURIComponent(name.trim().toLowerCase());

const safeThumb = (snip: any): string | null =>
  snip?.thumbnails?.high?.url ||
  snip?.thumbnails?.medium?.url ||
  snip?.thumbnails?.default?.url ||
  null;

const nowIso = () => new Date().toISOString();

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
  const [actionMsg, setActionMsg] = useState<string | null>(null);

  /* ================= DEBOUNCE ================= */

  useEffect(() => {
    const t = setTimeout(() => setDebounced(query.trim()), 350);
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
      setActionMsg(null);
      return;
    }
    runSearch(debounced);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debounced]);

  /* ================= CORE SEARCH ================= */

  const runSearch = async (q: string) => {
    setLoading(true);
    setActionMsg(null);

    try {
      // ---------- LOCAL SONGS ----------
      const { data: localTracks } = await externalSupabase
        .from("tracks")
        .select("id, external_id, title, artist, cover_url, duration")
        .or(`title.ilike.%${q}%,artist.ilike.%${q}%`)
        .limit(SONG_LIMIT);

      const safeTracks = (localTracks || []) as Track[];
      setSongs(safeTracks);

      // ---------- LOCAL PLAYLISTS ----------
      const { data: localPlaylists } = await externalSupabase
        .from("playlists")
        .select("id, title, cover_url")
        .ilike("title", `%${q}%`);

      setPlaylists((localPlaylists || []) as Playlist[]);

      // ---------- YOUTUBE ----------
      if (ytApiKey) {
        await runYoutubeSearch(q, safeTracks.length);
      } else {
        setYtSongs([]);
        setYtPlaylists([]);
        setYtArtists([]);
      }
    } catch (e) {
      console.error("Search error:", e);
    } finally {
      setLoading(false);
    }
  };

  /* ================= SEARCH CACHE (best-effort) ================= */

  const loadYoutubeCache = async (q: string) => {
    try {
      const { data } = await externalSupabase
        .from("search_cache")
        .select("id, results, updated_at")
        .eq("query", q)
        .eq("source", "youtube")
        .maybeSingle();

      if (!data?.results) return null;

      const updatedAt = data.updated_at ? new Date(data.updated_at).getTime() : 0;
      if (!updatedAt || Date.now() - updatedAt > YT_CACHE_TTL_MS) return null;

      return data.results as any;
    } catch {
      return null;
    }
  };

  const saveYoutubeCache = async (q: string, results: any) => {
    try {
      // upsert style: if row exists, update results + hit_count
      const { data: existing } = await externalSupabase
        .from("search_cache")
        .select("id, hit_count")
        .eq("query", q)
        .eq("source", "youtube")
        .maybeSingle();

      if (existing?.id) {
        await externalSupabase
          .from("search_cache")
          .update({
            results,
            hit_count: (existing.hit_count || 1) + 1,
            updated_at: nowIso(),
          })
          .eq("id", existing.id);
      } else {
        await externalSupabase.from("search_cache").insert({
          query: q,
          source: "youtube",
          results,
          hit_count: 1,
          created_at: nowIso(),
          updated_at: nowIso(),
        });
      }
    } catch {
      // ignore cache write failures
    }
  };

  /* ================= YOUTUBE SEARCH ================= */

  const runYoutubeSearch = async (q: string, localSongCount: number) => {
    // 1) try cache
    const cached = await loadYoutubeCache(q);
    if (cached?.ytSongs && cached?.ytPlaylists && cached?.ytArtists) {
      setYtSongs(cached.ytSongs);
      setYtPlaylists(cached.ytPlaylists);
      setYtArtists(cached.ytArtists);
      return;
    }

    const base = {
      key: ytApiKey!,
      part: "snippet",
      q,
      safeSearch: "none",
    };

    // 2) fetch
    let nextYtSongs: YoutubeItem[] = [];
    let nextYtPlaylists: YoutubeItem[] = [];
    let nextYtArtists: YoutubeItem[] = [];

    // SONGS: only if local has less than 10
    if (localSongCount < SONG_LIMIT) {
      const res = await fetch(
        `https://www.googleapis.com/youtube/v3/search?${new URLSearchParams({
          ...base,
          type: "video",
          videoCategoryId: "10", // Music
          maxResults: "25",
        })}`
      );
      const json = await res.json();

      nextYtSongs = (json.items || [])
        .filter((i: any) => i?.id?.videoId)
        .slice(0, SONG_LIMIT)
        .map((i: any) => ({
          id: i.id.videoId,
          type: "video" as const,
          title: i.snippet.title,
          channelTitle: i.snippet.channelTitle,
          thumbnail: safeThumb(i.snippet),
          channelId: i.snippet.channelId ?? null,
        }));
    }

    // PLAYLISTS
    const plRes = await fetch(
      `https://www.googleapis.com/youtube/v3/search?${new URLSearchParams({
        ...base,
        type: "playlist",
        maxResults: String(YT_PLAYLIST_LIMIT),
      })}`
    );
    const plJson = await plRes.json();

    nextYtPlaylists = (plJson.items || [])
      .filter((i: any) => i?.id?.playlistId)
      .map((i: any) => ({
        id: i.id.playlistId,
        type: "playlist" as const,
        title: i.snippet.title,
        channelTitle: i.snippet.channelTitle,
        thumbnail: safeThumb(i.snippet),
        channelId: i.snippet.channelId ?? null,
      }));

    // ARTISTS / CHANNELS
    const chRes = await fetch(
      `https://www.googleapis.com/youtube/v3/search?${new URLSearchParams({
        ...base,
        type: "channel",
        maxResults: String(YT_ARTIST_LIMIT),
      })}`
    );
    const chJson = await chRes.json();

    nextYtArtists = (chJson.items || [])
      .filter((i: any) => i?.id?.channelId)
      .map((i: any) => ({
        id: i.id.channelId,
        type: "channel" as const,
        title: i.snippet.title,
        channelTitle: i.snippet.title,
        thumbnail: safeThumb(i.snippet),
        channelId: i.id.channelId ?? null,
      }));

    setYtSongs(nextYtSongs);
    setYtPlaylists(nextYtPlaylists);
    setYtArtists(nextYtArtists);

    // 3) save cache
    await saveYoutubeCache(q, {
      ytSongs: nextYtSongs,
      ytPlaylists: nextYtPlaylists,
      ytArtists: nextYtArtists,
    });
  };

  /* ================= ACTIONS ================= */

  const handleLocalPlay = (t: Track) => {
    setActionMsg(null);
    playTrack(t.external_id, t.title, t.artist, t.id);
  };

  const handleYoutubeSongClick = async (y: YoutubeItem) => {
    if (!ytApiKey) return;
    setActionMsg("Importing song…");

    try {
      // already in DB?
      const { data: existing } = await externalSupabase
        .from("tracks")
        .select("id, external_id, title, artist")
        .eq("external_id", y.id)
        .maybeSingle();

      if (existing?.id) {
        setActionMsg(null);
        playTrack(existing.external_id, existing.title, existing.artist, existing.id);
        return;
      }

      // fetch video metadata (official Data API)
      const res = await fetch(
        `https://www.googleapis.com/youtube/v3/videos?${new URLSearchParams({
          key: ytApiKey,
          part: "snippet,contentDetails",
          id: y.id,
          fields:
            "items(id,snippet(title,channelTitle,thumbnails(high(url),medium(url),default(url))))",
        })}`
      );
      const json = await res.json();
      const v = json.items?.[0];
      if (!v) {
        setActionMsg("Import failed (no metadata).");
        return;
      }

      const { data: inserted, error } = await externalSupabase
        .from("tracks")
        .insert({
          source: "youtube",
          external_id: y.id,
          title: v.snippet.title,
          artist: v.snippet.channelTitle,
          cover_url: safeThumb(v.snippet),
        })
        .select("id, external_id, title, artist")
        .single();

      if (error || !inserted) {
        console.error("Track insert error", error);
        setActionMsg("Import failed.");
        return;
      }

      setActionMsg(null);
      playTrack(inserted.external_id, inserted.title, inserted.artist, inserted.id);
    } catch (e) {
      console.error(e);
      setActionMsg("Import failed.");
    }
  };

  const openArtist = (artistName: string, channelId?: string | null) => {
    const key = encodeArtistKey(artistName);
    navigate(`/artist/${key}`, { state: { artistName, channelId: channelId ?? null } });
  };

  const handleYoutubePlaylistClick = async (y: YoutubeItem) => {
    if (!ytApiKey) return;
    setActionMsg("Importing playlist…");

    try {
      // 1) get or create playlist in DB (external_id = yt playlistId)
      const { data: existing } = await externalSupabase
        .from("playlists")
        .select("id")
        .eq("external_id", y.id)
        .maybeSingle();

      let playlistId = existing?.id as string | undefined;

      if (!playlistId) {
        const { data: inserted, error } = await externalSupabase
          .from("playlists")
          .insert({
            external_id: y.id,
            title: y.title,
            cover_url: y.thumbnail,
            is_public: true,
            channel_title: y.channelTitle,
          })
          .select("id")
          .single();

        if (error || !inserted?.id) {
          console.error("Playlist insert error", error);
          setActionMsg("Playlist import failed.");
          return;
        }
        playlistId = inserted.id;
      }

      // 2) import tracks into playlist_tracks
      await importYoutubePlaylistTracks(y.id, playlistId);

      // 3) open playlist page
      setActionMsg(null);
      navigate(`/playlist/${playlistId}`);
    } catch (e) {
      console.error(e);
      setActionMsg("Playlist import failed.");
    }
  };

  const importYoutubePlaylistTracks = async (youtubePlaylistId: string, playlistId: string) => {
    if (!ytApiKey) return;

    // NOTE: maxResults=50 (simple v1). pagination can be added later.
    const itemsRes = await fetch(
      `https://www.googleapis.com/youtube/v3/playlistItems?${new URLSearchParams({
        key: ytApiKey,
        part: "contentDetails",
        playlistId: youtubePlaylistId,
        maxResults: "50",
      })}`
    );
    const itemsJson = await itemsRes.json();
    const items = itemsJson.items || [];
    if (!items.length) return;

    const videoIds: string[] = items
      .map((i: any) => i?.contentDetails?.videoId)
      .filter(Boolean);

    // fetch metadata for all videos
    const videosRes = await fetch(
      `https://www.googleapis.com/youtube/v3/videos?${new URLSearchParams({
        key: ytApiKey,
        part: "snippet",
        id: videoIds.join(","),
        fields:
          "items(id,snippet(title,channelTitle,thumbnails(high(url),medium(url),default(url))))",
      })}`
    );
    const videosJson = await videosRes.json();
    const videos = videosJson.items || [];

    let position = 0;
    let linked = 0;

    for (const v of videos) {
      const videoId = v.id as string;

      // upsert track by external_id
      const { data: existingTrack } = await externalSupabase
        .from("tracks")
        .select("id")
        .eq("external_id", videoId)
        .maybeSingle();

      let trackId: string | null = existingTrack?.id ?? null;

      if (!trackId) {
        const { data: insertedTrack } = await externalSupabase
          .from("tracks")
          .insert({
            source: "youtube",
            external_id: videoId,
            title: v.snippet.title,
            artist: v.snippet.channelTitle,
            cover_url: safeThumb(v.snippet),
          })
          .select("id")
          .single();

        trackId = insertedTrack?.id ?? null;
      }

      if (!trackId) continue;

      // link (no duplicates due to PK (playlist_id, track_id))
      await externalSupabase.from("playlist_tracks").upsert({
        playlist_id: playlistId,
        track_id: trackId,
        position,
      });

      position += 1;
      linked += 1;
    }

    // update track_count
    await externalSupabase
      .from("playlists")
      .update({ track_count: linked })
      .eq("id", playlistId);
  };

  /* ================= UI / derived ================= */

  const showSongsSection = songs.length > 0 || ytSongs.length > 0;
  const showPlaylistsSection = playlists.length > 0 || ytPlaylists.length > 0;

  const localSongsLabel = useMemo(() => (songs.length ? `Local (${songs.length})` : "Local"), [songs.length]);
  const ytSongsLabel = useMemo(() => (ytSongs.length ? `YouTube (${ytSongs.length})` : "YouTube"), [ytSongs.length]);

  /* ================= RENDER ================= */

  return (
    <div className="p-4 max-w-4xl mx-auto pb-32">
      {/* SEARCH INPUT */}
      <div className="relative mb-4">
        <SearchIcon className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-muted-foreground" />
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search songs, artists or playlists"
          className="pl-12 h-12"
        />
      </div>

      {loading && <p className="text-muted-foreground mb-2">Searching…</p>}
      {actionMsg && (
        <div className="mb-4 rounded-lg border border-border bg-card/60 px-3 py-2 text-sm text-muted-foreground">
          {actionMsg}
        </div>
      )}

      {/* ARTISTS / CHANNELS */}
      {ytArtists.length > 0 && (
        <section className="mb-8">
          <h2 className="flex items-center gap-2 text-xl font-bold mb-3">
            <User className="w-5 h-5" /> Artists
          </h2>

          <div className="flex gap-4 overflow-x-auto pb-2">
            {ytArtists.map((a) => (
              <button
                key={a.id}
                type="button"
                onClick={() => openArtist(a.title, a.id)}
                className="min-w-[150px] text-left rounded-lg border border-border bg-card/40 hover:bg-card transition-colors p-3"
              >
                {a.thumbnail ? (
                  <img
                    src={a.thumbnail}
                    alt={a.title}
                    className="w-20 h-20 rounded-full object-cover mb-2"
                  />
                ) : (
                  <div className="w-20 h-20 rounded-full bg-muted mb-2" />
                )}
                <div className="text-sm font-semibold line-clamp-1">{a.title}</div>
                <div className="text-xs text-muted-foreground flex items-center gap-1 mt-1">
                  <Youtube className="w-3 h-3" /> Channel
                </div>
              </button>
            ))}
          </div>
        </section>
      )}

      {/* SONGS */}
      {showSongsSection && (
        <section className="mb-10">
          <h2 className="flex items-center gap-2 text-xl font-bold mb-4">
            <Music className="w-5 h-5" /> Songs
          </h2>

          {songs.length > 0 && (
            <div className="mb-2 text-xs text-muted-foreground">{localSongsLabel}</div>
          )}
          {songs.map((s) => (
            <button
              key={s.id}
              type="button"
              onClick={() => handleLocalPlay(s)}
              className="block w-full text-left py-2 border-b border-border hover:bg-white/5"
            >
              <div className="font-medium">{s.title}</div>
              <div className="text-sm text-muted-foreground flex items-center gap-2">
                <span>{s.artist}</span>
                {s.artist && (
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      openArtist(s.artist, null);
                    }}
                    className="text-xs inline-flex items-center gap-1 px-2 py-0.5 rounded border border-border hover:bg-white/5"
                  >
                    <ExternalLink className="w-3 h-3" />
                    Artist
                  </button>
                )}
              </div>
            </button>
          ))}

          {ytSongs.length > 0 && (
            <div className="mt-4 mb-2 text-xs text-muted-foreground">{ytSongsLabel}</div>
          )}
          {ytSongs.map((y) => (
            <button
              key={y.id}
              type="button"
              onClick={() => handleYoutubeSongClick(y)}
              className="block w-full text-left py-2 border-b border-border hover:bg-white/5"
            >
              <div className="font-medium line-clamp-1">{y.title}</div>
              <div className="text-sm text-muted-foreground flex items-center gap-2">
                <span className="inline-flex items-center gap-1">
                  <Youtube className="w-4 h-4" />
                  {y.channelTitle}
                </span>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    openArtist(y.channelTitle, y.channelId ?? null);
                  }}
                  className="text-xs inline-flex items-center gap-1 px-2 py-0.5 rounded border border-border hover:bg-white/5"
                >
                  <ExternalLink className="w-3 h-3" />
                  Artist
                </button>
              </div>
            </button>
          ))}
        </section>
      )}

      {/* PLAYLISTS */}
      {showPlaylistsSection && (
        <section>
          <h2 className="flex items-center gap-2 text-xl font-bold mb-4">
            <ListMusic className="w-5 h-5" /> Playlists
          </h2>

          {/* Local playlists MUST be Link (guaranteed navigation) */}
          {playlists.map((p) => (
            <Link
              key={p.id}
              to={`/playlist/${p.id}`}
              className="block w-full text-left py-2 border-b border-border hover:bg-white/5"
            >
              <div className="font-medium">{p.title}</div>
            </Link>
          ))}

          {/* YouTube playlists -> import + navigate */}
          {ytPlaylists.map((y) => (
            <button
              key={y.id}
              type="button"
              onClick={() => handleYoutubePlaylistClick(y)}
              className="flex items-center gap-3 py-2 border-b border-border w-full text-left hover:bg-white/5"
            >
              {y.thumbnail ? (
                <img src={y.thumbnail} alt={y.title} className="w-20 h-12 rounded object-cover" />
              ) : (
                <div className="w-20 h-12 rounded bg-muted" />
              )}
              <div className="min-w-0">
                <div className="font-medium line-clamp-1">{y.title}</div>
                <div className="text-sm text-muted-foreground inline-flex items-center gap-1">
                  <Youtube className="w-4 h-4" />
                  {y.channelTitle}
                </div>
              </div>
            </button>
          ))}
        </section>
      )}

      {/* Empty state */}
      {!loading && debounced && !showSongsSection && !showPlaylistsSection && (
        <div className="text-sm text-muted-foreground mt-6">
          No results for <span className="font-semibold">{debounced}</span>.
          {ytApiKey ? " Try a different query." : " (YouTube API key missing.)"}
        </div>
      )}
    </div>
  );
}
