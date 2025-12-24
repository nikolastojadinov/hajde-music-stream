import { useEffect, useMemo, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { ListMusic, Music, Play, ArrowLeft } from "lucide-react";

import { Button } from "@/components/ui/button";
import EmptyState from "@/components/ui/EmptyState";
import ErrorState from "@/components/ui/ErrorState";
import PlaylistCard from "@/components/PlaylistCard";
import TrackCard from "@/components/TrackCard";
import { ScrollArea, ScrollBar } from "@/components/ui/scroll-area";
import { usePlayer } from "@/contexts/PlayerContext";
import { fetchArtistByKey } from "@/lib/api/artist";

type ApiPlaylist = {
  id: string;
  title: string;
  youtube_playlist_id: string;
  cover_url?: string | null;
  youtube_channel_id?: string;
  source?: string;
  created_at?: string | null;
};

type ApiTrack = {
  id: string;
  title: string;
  youtube_video_id: string;
  cover_url?: string | null;
  duration?: number | null;
  youtube_channel_id?: string;
  artist_name?: string | null;
  created_at?: string | null;
};

type ArtistOkResponse = {
  status: "ok";
  artist: {
    artist_name: string;
    youtube_channel_id: string | null;
    thumbnail_url: string | null;
    banner_url: string | null;
  };
  playlists: ApiPlaylist[];
  tracks: ApiTrack[];
};

type ArtistNotReadyResponse = {
  status: "not_ready";
};

type ArtistErrorResponse = {
  error: string;
};

function normalizeString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function formatCount(n: number): string {
  return new Intl.NumberFormat().format(n);
}

function isOk(x: any): x is ArtistOkResponse {
  return (
    x &&
    typeof x === "object" &&
    x.status === "ok" &&
    x.artist &&
    typeof x.artist === "object" &&
    Array.isArray(x.playlists) &&
    Array.isArray(x.tracks)
  );
}

function isNotReady(x: any): x is ArtistNotReadyResponse {
  return x && typeof x === "object" && x.status === "not_ready";
}

function isError(x: any): x is ArtistErrorResponse {
  return x && typeof x === "object" && typeof x.error === "string";
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function cleanTrackTitle(rawTitle: string, canonicalArtistName: string): string {
  const title = normalizeString(rawTitle) || "Unknown title";
  const artist = normalizeString(canonicalArtistName);

  if (!artist) return title;

  const pattern = new RegExp(`^${escapeRegex(artist)}\s*-\s*`, "i");
  const stripped = title.replace(pattern, "").trim();
  return stripped || title;
}

export default function Artist() {
  const { artistKey: artistKeyParam } = useParams();
  const { playPlaylist } = usePlayer();
  const navigate = useNavigate();

  const artistKey = normalizeString(artistKeyParam);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<"ok" | "not_ready" | "unknown">("unknown");
  const [reloadNonce, setReloadNonce] = useState(0);

  const [playlists, setPlaylists] = useState<ApiPlaylist[]>([]);
  const [tracks, setTracks] = useState<ApiTrack[]>([]);
  const [artistMedia, setArtistMedia] = useState<{ thumbnail_url: string | null; banner_url: string | null } | null>(null);
  const [artistTitle, setArtistTitle] = useState<string>(artistKey);

  const canonicalArtistName = useMemo(() => {
    const fromApi = normalizeString(artistTitle);
    if (fromApi) return fromApi;
    const fallback = normalizeString(artistKey);
    return fallback || "Artist";
  }, [artistTitle, artistKey]);

  const playlistTracks = useMemo(() => {
    return tracks
      .filter((t) => t && typeof t === "object" && t.youtube_video_id)
      .map((t) => ({
        id: t.id,
        external_id: t.youtube_video_id,
        title: cleanTrackTitle(t.title, canonicalArtistName),
        artist: canonicalArtistName,
      }));
  }, [tracks, canonicalArtistName]);

  const handlePlayAll = () => {
    if (playlistTracks.length === 0) return;
    playPlaylist(playlistTracks, 0);
  };

  const retry = () => {
    if (!artistKey) return;
    setReloadNonce((x) => x + 1);
  };

  const handleBack = () => {
    const idx = (window.history.state as { idx?: number } | null)?.idx;
    if (typeof idx === "number" && idx > 0) navigate(-1);
    else navigate("/search");
  };

  useEffect(() => {
    let active = true;

    async function load() {
      if (!artistKey) {
        setLoading(false);
        setError("Missing artist");
        setStatus("unknown");
        setPlaylists([]);
        setTracks([]);
        setArtistMedia(null);
        setArtistTitle("");
        return;
      }

      try {
        setLoading(true);
        setError(null);

        setArtistTitle(artistKey);

        const json = await fetchArtistByKey(artistKey, { force: reloadNonce > 0 });
        if (!active) return;

        if (isNotReady(json)) {
          setStatus("not_ready");
          setPlaylists([]);
          setTracks([]);
          setArtistMedia(null);
          return;
        }

        if (isOk(json)) {
          setStatus("ok");
          setPlaylists(Array.isArray(json.playlists) ? json.playlists : []);
          setTracks(Array.isArray(json.tracks) ? json.tracks : []);
          setArtistTitle(normalizeString(json.artist?.artist_name) || artistKey);
          setArtistMedia({
            thumbnail_url: json.artist?.thumbnail_url ?? null,
            banner_url: json.artist?.banner_url ?? null,
          });
          return;
        }

        if (isError(json)) {
          setError(json.error || "Artist request failed");
          setStatus("unknown");
          setPlaylists([]);
          setTracks([]);
          setArtistMedia(null);
          return;
        }

        setError("Artist request failed");
        setStatus("unknown");
        setPlaylists([]);
        setTracks([]);
        setArtistMedia(null);
      } catch (e: any) {
        if (!active) return;
        setError(e?.message || "Artist request failed");
        setStatus("unknown");
        setPlaylists([]);
        setTracks([]);
        setArtistMedia(null);
      } finally {
        if (!active) return;
        setLoading(false);
      }
    }

    void load();
    return () => {
      active = false;
    };
  }, [artistKey, reloadNonce]);

  if (loading) {
    return (
      <div className="p-4 max-w-4xl mx-auto pb-32">
        <div className="min-h-[60vh] flex items-center justify-center">
          <div className="text-muted-foreground">Učitavanje…</div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-4 max-w-4xl mx-auto pb-32">
        <ErrorState title="Artist request failed" subtitle={error} onRetry={artistKey ? retry : undefined} />
      </div>
    );
  }

  if (status === "not_ready") {
    return (
      <div className="p-4 max-w-4xl mx-auto pb-32">
        <div className="mb-6">
          <h1 className="text-2xl font-bold truncate">{canonicalArtistName || "Artist"}</h1>
          <div className="text-sm text-muted-foreground mt-1">Artist is being prepared. Please retry.</div>
          <div className="mt-4">
            <Button type="button" onClick={retry}>
              Retry
            </Button>
          </div>
        </div>

        <section className="mb-10">
          <h2 className="text-xl font-bold mb-4">Playlists</h2>
          <EmptyState title="No playlists yet" subtitle="This artist doesn’t have any playlists available" />
        </section>

        <section>
          <h2 className="text-xl font-bold mb-4">Tracks</h2>
          <EmptyState title="No tracks yet" subtitle="This artist doesn’t have any tracks available" />
        </section>
      </div>
    );
  }

  const displayInitial = (canonicalArtistName || "?").trim()[0]?.toUpperCase() ?? "?";

  return (
    <div className="relative">
      <div className="absolute left-2 top-2 z-10">
        <Button
          type="button"
          variant="ghost"
          size="icon"
          onClick={handleBack}
          aria-label="Back"
        >
          <ArrowLeft className="h-5 w-5" />
        </Button>
      </div>

      <div className="flex-1 overflow-y-auto pb-32">
        {/* ===== HEADER ===== */}
        <div className="pt-6 px-4 text-center">
          <div className="flex justify-center mb-4">
            <div className="w-28 h-28 rounded-full overflow-hidden bg-card border border-border flex items-center justify-center">
              {artistMedia?.thumbnail_url ? (
                <img
                  src={artistMedia.thumbnail_url}
                  alt={canonicalArtistName || "Artist"}
                  className="w-full h-full object-cover"
                  loading="lazy"
                />
              ) : (
                <div className="text-3xl font-bold text-muted-foreground">{displayInitial}</div>
              )}
            </div>
          </div>

          <h1 className="font-black text-[26px] leading-tight truncate">{canonicalArtistName || "Artist"}</h1>
          <p className="text-sm text-muted-foreground mt-1">
            {formatCount(tracks.length)} tracks • {formatCount(playlists.length)} playlists
          </p>

          <div className="flex justify-center items-center gap-4 mt-5">
            <Button size="lg" className="rounded-full" onClick={handlePlayAll} disabled={playlistTracks.length === 0}>
              <Play className="w-5 h-5 mr-2 fill-current" />
              Play
            </Button>
          </div>
        </div>

        {/* ===== PLAYLIST FLOW (home-like) ===== */}
        <section className="mt-8">
          <div className="px-4 flex items-center gap-2 mb-4">
            <ListMusic className="w-5 h-5 text-muted-foreground" />
            <h2 className="text-xl font-bold">Playlists</h2>
          </div>

          {playlists.length === 0 ? (
            <div className="px-4">
              <EmptyState title="No playlists yet" subtitle="This artist doesn’t have any playlists available" />
            </div>
          ) : (
            <div className="px-4">
              <ScrollArea className="w-full whitespace-nowrap rounded-md">
                <div className="flex w-max space-x-4 pb-4">
                  {playlists.map((p) => (
                    <div key={p.id} className="w-[140px]">
                      <PlaylistCard
                        id={p.id}
                        title={p.title}
                        description=""
                        imageUrl={p.cover_url || "/placeholder.svg"}
                        linkState={{ fromArtist: true }}
                      />
                    </div>
                  ))}
                </div>
                <ScrollBar orientation="horizontal" />
              </ScrollArea>
            </div>
          )}
        </section>

        {/* ===== TRACK LIST (playlist-like vertical list) ===== */}
        <section className="mt-8">
          <div className="px-4 flex items-center gap-2 mb-4">
            <Music className="w-5 h-5 text-muted-foreground" />
            <h2 className="text-xl font-bold">Tracks</h2>
          </div>

          {tracks.length === 0 ? (
            <div className="px-4">
              <EmptyState title="No tracks yet" subtitle="This artist doesn’t have any tracks available" />
            </div>
          ) : (
            <div className="px-4 space-y-2">
              {tracks.map((t) => {
                const cleanTitle = cleanTrackTitle(t.title, canonicalArtistName);

                return (
                  <TrackCard
                    key={t.id}
                    id={t.id}
                    title={cleanTitle}
                    artist={canonicalArtistName}
                    imageUrl={t.cover_url || null}
                    youtubeId={t.youtube_video_id}
                    duration={t.duration ?? null}
                  />
                );
              })}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
