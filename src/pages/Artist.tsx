import { useEffect, useMemo, useState } from "react";
import { useParams } from "react-router-dom";
import { Play } from "lucide-react";

import { Button } from "@/components/ui/button";
import EmptyState from "@/components/ui/EmptyState";
import ErrorState from "@/components/ui/ErrorState";
import { usePlayer } from "@/contexts/PlayerContext";

type ApiPlaylist = {
  id: string;
  title: string;
  youtube_playlist_id: string;
  youtube_channel_id?: string;
  source?: string;
  created_at?: string | null;
};

type ApiTrack = {
  id: string;
  title: string;
  youtube_video_id: string;
  youtube_channel_id?: string;
  artist_name?: string | null;
  created_at?: string | null;
};

type ArtistOkResponse = {
  status: "ok";
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
  return x && typeof x === "object" && x.status === "ok" && Array.isArray(x.playlists) && Array.isArray(x.tracks);
}

function isNotReady(x: any): x is ArtistNotReadyResponse {
  return x && typeof x === "object" && x.status === "not_ready";
}

function isError(x: any): x is ArtistErrorResponse {
  return x && typeof x === "object" && typeof x.error === "string";
}

export default function Artist() {
  const { artistName: artistNameParam } = useParams();
  const { playPlaylist } = usePlayer();

  const artistName = normalizeString(artistNameParam);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<"ok" | "not_ready" | "unknown">("unknown");
  const [reloadNonce, setReloadNonce] = useState(0);

  const [playlists, setPlaylists] = useState<ApiPlaylist[]>([]);
  const [tracks, setTracks] = useState<ApiTrack[]>([]);

  const playlistTracks = useMemo(() => {
    return tracks
      .filter((t) => t && typeof t === "object" && t.youtube_video_id)
      .map((t) => ({
        id: t.id,
        external_id: t.youtube_video_id,
        title: t.title,
        artist: t.artist_name || artistName || "Unknown artist",
      }));
  }, [tracks, artistName]);

  const retry = () => {
    if (!artistName) return;
    setReloadNonce((x) => x + 1);
  };

  useEffect(() => {
    let active = true;

    async function load() {
      if (!artistName) {
        setLoading(false);
        setError("Missing artist name");
        setStatus("unknown");
        setPlaylists([]);
        setTracks([]);
        return;
      }

      try {
        setLoading(true);
        setError(null);

        const res = await fetch(`/api/artist/${encodeURIComponent(artistName)}`, {
          method: "GET",
          headers: { Accept: "application/json" },
        });
        const json = await res.json().catch(() => ({}));
        if (!active) return;

        if (isNotReady(json)) {
          setStatus("not_ready");
          setPlaylists([]);
          setTracks([]);
          return;
        }

        if (isOk(json)) {
          setStatus("ok");
          setPlaylists(Array.isArray(json.playlists) ? json.playlists : []);
          setTracks(Array.isArray(json.tracks) ? json.tracks : []);
          return;
        }

        if (isError(json)) {
          setError(json.error || "Artist request failed");
          setStatus("unknown");
          setPlaylists([]);
          setTracks([]);
          return;
        }

        if (!res.ok) {
          setError("Artist request failed");
          setStatus("unknown");
          setPlaylists([]);
          setTracks([]);
          return;
        }

        setError("Artist request failed");
        setStatus("unknown");
        setPlaylists([]);
        setTracks([]);
      } catch (e: any) {
        if (!active) return;
        setError(e?.message || "Artist request failed");
        setStatus("unknown");
        setPlaylists([]);
        setTracks([]);
      } finally {
        if (!active) return;
        setLoading(false);
      }
    }

    void load();
    return () => {
      active = false;
    };
  }, [artistName, reloadNonce]);

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
        <ErrorState title="Artist request failed" subtitle={error} onRetry={artistName ? retry : undefined} />
      </div>
    );
  }

  if (status === "not_ready") {
    return (
      <div className="p-4 max-w-4xl mx-auto pb-32">
        <div className="mb-6">
          <h1 className="text-2xl font-bold truncate">{artistName || "Artist"}</h1>
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

  return (
    <div className="p-4 max-w-4xl mx-auto pb-32">
      <div className="flex items-center gap-4 mb-6">
        <div className="flex-1 min-w-0">
          <h1 className="text-2xl font-bold truncate">{artistName || "Artist"}</h1>
          <div className="text-sm text-muted-foreground">
            {formatCount(playlists.length)} playlists • {formatCount(tracks.length)} tracks
          </div>
        </div>

        <Button
          onClick={() => {
            if (playlistTracks.length === 0) return;
            playPlaylist(playlistTracks, 0);
          }}
          disabled={playlistTracks.length === 0}
          className="shrink-0"
        >
          <Play className="w-4 h-4 mr-2" /> Play All
        </Button>
      </div>

      <section className="mb-10">
        <h2 className="text-xl font-bold mb-4">Playlists</h2>
        {playlists.length === 0 ? (
          <EmptyState title="No playlists yet" subtitle="This artist doesn’t have any playlists available" />
        ) : (
          <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
            {playlists.map((p) => (
              <a
                key={p.id}
                href={`https://www.youtube.com/playlist?list=${encodeURIComponent(p.youtube_playlist_id)}`}
                target="_blank"
                rel="noreferrer"
                className="rounded-lg border border-border bg-card/30 px-3 py-3 hover:bg-card/50 transition-colors"
              >
                <div className="font-medium line-clamp-2">{p.title}</div>
                {p.source ? <div className="text-xs text-muted-foreground mt-1">{p.source}</div> : null}
              </a>
            ))}
          </div>
        )}
      </section>

      <section>
        <h2 className="text-xl font-bold mb-4">Tracks</h2>
        {tracks.length === 0 ? (
          <EmptyState title="No tracks yet" subtitle="This artist doesn’t have any tracks available" />
        ) : (
          <div className="space-y-2">
            {tracks.map((t) => {
              const idx = playlistTracks.findIndex((x) => x.id === t.id);
              return (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => {
                    if (idx < 0) return;
                    playPlaylist(playlistTracks, idx);
                  }}
                  className="w-full text-left rounded-lg border border-border bg-card/30 px-3 py-3 hover:bg-card/50 transition-colors"
                >
                  <div className="font-medium truncate">{t.title}</div>
                  <div className="text-sm text-muted-foreground truncate">{t.artist_name || artistName || "Unknown artist"}</div>
                </button>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}
