import { useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate, useParams, Link } from "react-router-dom";
import { Music, ListMusic, Youtube, ArrowLeft } from "lucide-react";
import { externalSupabase } from "@/lib/externalSupabase";
import { usePlayer } from "@/contexts/PlayerContext";

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
  title: string;
  channelTitle: string;
  thumbnail: string | null;
}

const ytApiKey = import.meta.env.VITE_YOUTUBE_API_KEY as string | undefined;

const safeThumb = (snip: any): string | null =>
  snip?.thumbnails?.high?.url ||
  snip?.thumbnails?.medium?.url ||
  snip?.thumbnails?.default?.url ||
  null;

export default function Artist() {
  const { artistKey } = useParams<{ artistKey: string }>();
  const navigate = useNavigate();
  const location = useLocation() as any;
  const { playTrack } = usePlayer();

  const artistNameFromState = location?.state?.artistName as string | undefined;
  const channelIdFromState = (location?.state?.channelId as string | null | undefined) ?? null;

  const artistName = useMemo(() => {
    if (artistNameFromState) return artistNameFromState;
    try {
      return decodeURIComponent(artistKey || "");
    } catch {
      return artistKey || "";
    }
  }, [artistKey, artistNameFromState]);

  const [tracks, setTracks] = useState<Track[]>([]);
  const [playlists, setPlaylists] = useState<Playlist[]>([]);
  const [ytVideos, setYtVideos] = useState<YoutubeItem[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!artistName) return;
    loadArtist(artistName);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [artistName]);

  const loadArtist = async (name: string) => {
    setLoading(true);

    try {
      // 1) local tracks for this artist
      const { data: t } = await externalSupabase
        .from("tracks")
        .select("id, external_id, title, artist, cover_url, duration")
        .ilike("artist", `%${name}%`)
        .limit(40);

      const safeTracks = (t || []) as Track[];
      setTracks(safeTracks);

      // 2) playlists that contain these tracks (via playlist_tracks)
      const trackIds = safeTracks.map((x) => x.id);
      if (trackIds.length > 0) {
        const { data: pt } = await externalSupabase
          .from("playlist_tracks")
          .select("playlist_id")
          .in("track_id", trackIds)
          .limit(200);

        const playlistIds = Array.from(
          new Set((pt || []).map((r: any) => r.playlist_id).filter(Boolean))
        ).slice(0, 40);

        if (playlistIds.length > 0) {
          const { data: pls } = await externalSupabase
            .from("playlists")
            .select("id, title, cover_url")
            .in("id", playlistIds)
            .limit(40);

          setPlaylists((pls || []) as Playlist[]);
        } else {
          setPlaylists([]);
        }
      } else {
        setPlaylists([]);
      }

      // 3) YouTube fallback: top music videos from channel (if available)
      if (ytApiKey && channelIdFromState) {
        const res = await fetch(
          `https://www.googleapis.com/youtube/v3/search?${new URLSearchParams({
            key: ytApiKey,
            part: "snippet",
            channelId: channelIdFromState,
            type: "video",
            videoCategoryId: "10",
            maxResults: "10",
            safeSearch: "none",
            order: "relevance",
            q: name,
          })}`
        );
        const json = await res.json();
        setYtVideos(
          (json.items || [])
            .filter((i: any) => i?.id?.videoId)
            .map((i: any) => ({
              id: i.id.videoId,
              title: i.snippet.title,
              channelTitle: i.snippet.channelTitle,
              thumbnail: safeThumb(i.snippet),
            }))
        );
      } else {
        setYtVideos([]);
      }
    } catch (e) {
      console.error("Artist load failed", e);
    } finally {
      setLoading(false);
    }
  };

  const handlePlay = (t: Track) => {
    playTrack(t.external_id, t.title, t.artist, t.id);
  };

  return (
    <div className="p-4 max-w-4xl mx-auto pb-32">
      <div className="flex items-center gap-2 mb-4">
        <button
          type="button"
          onClick={() => navigate(-1)}
          className="inline-flex items-center gap-2 px-3 py-2 rounded border border-border hover:bg-white/5"
        >
          <ArrowLeft className="w-4 h-4" />
          Back
        </button>

        <h1 className="text-xl font-black truncate">{artistName}</h1>
      </div>

      {loading && <p className="text-muted-foreground mb-4">Loading…</p>}

      {/* Local tracks */}
      {tracks.length > 0 && (
        <section className="mb-10">
          <h2 className="flex items-center gap-2 text-xl font-bold mb-4">
            <Music className="w-5 h-5" /> Songs
          </h2>

          {tracks.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => handlePlay(t)}
              className="block w-full text-left py-2 border-b border-border hover:bg-white/5"
            >
              <div className="font-medium">{t.title}</div>
              <div className="text-sm text-muted-foreground">{t.artist}</div>
            </button>
          ))}
        </section>
      )}

      {/* Local playlists */}
      {playlists.length > 0 && (
        <section className="mb-10">
          <h2 className="flex items-center gap-2 text-xl font-bold mb-4">
            <ListMusic className="w-5 h-5" /> Playlists
          </h2>

          {playlists.map((p) => (
            <Link
              key={p.id}
              to={`/playlist/${p.id}`}
              className="block w-full text-left py-2 border-b border-border hover:bg-white/5"
            >
              {p.title}
            </Link>
          ))}
        </section>
      )}

      {/* YouTube fallback */}
      {ytVideos.length > 0 && (
        <section>
          <h2 className="flex items-center gap-2 text-xl font-bold mb-4">
            <Youtube className="w-5 h-5 text-red-500" /> YouTube
          </h2>

          {ytVideos.map((v) => (
            <div key={v.id} className="flex items-center gap-3 py-2 border-b border-border">
              {v.thumbnail ? (
                <img src={v.thumbnail} className="w-20 h-12 rounded object-cover" />
              ) : (
                <div className="w-20 h-12 rounded bg-muted" />
              )}
              <div className="min-w-0">
                <div className="font-medium line-clamp-1">{v.title}</div>
                <div className="text-sm text-muted-foreground line-clamp-1">{v.channelTitle}</div>
              </div>
            </div>
          ))}
        </section>
      )}

      {!loading && tracks.length === 0 && playlists.length === 0 && ytVideos.length === 0 && (
        <div className="text-sm text-muted-foreground">
          No results for <span className="font-semibold">{artistName}</span>.
        </div>
      )}
    </div>
  );
}
