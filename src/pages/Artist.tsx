import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { withBackendOrigin } from "@/lib/backendUrl";

type ArtistRow = {
  id?: string;
  artist?: string;
  banner_url?: string | null;
  thumbnail_url?: string | null;
};

type PlaylistRow = {
  id?: string;
  title?: string;
  cover_url?: string | null;
};

type TrackRow = {
  id?: string;
  title?: string;
  artist?: string;
};

type ArtistApiResponse = {
  artist: ArtistRow | null;
  playlists: PlaylistRow[];
  tracks: TrackRow[];
};

function normalizeString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

export default function Artist() {
  const { channelId = "" } = useParams<{ channelId: string }>();

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [artist, setArtist] = useState<ArtistRow | null>(null);
  const [playlists, setPlaylists] = useState<PlaylistRow[]>([]);
  const [tracks, setTracks] = useState<TrackRow[]>([]);

  useEffect(() => {
    const id = normalizeString(channelId);
    if (!id) {
      setLoading(false);
      setError("Missing artist channel id");
      return;
    }

    const controller = new AbortController();
    let mounted = true;

    const run = async () => {
      setLoading(true);
      setError(null);

      try {
        const url = withBackendOrigin(`/api/artist/${encodeURIComponent(id)}`);
        const res = await fetch(url, { method: "GET", signal: controller.signal });
        const json = (await res.json().catch(() => null)) as ArtistApiResponse | null;

        if (!res.ok) {
          const msg = (json as any)?.error || "Failed to load artist";
          throw new Error(String(msg));
        }

        if (!mounted) return;

        setArtist(json?.artist ?? null);
        setPlaylists(Array.isArray(json?.playlists) ? json!.playlists : []);
        setTracks(Array.isArray(json?.tracks) ? json!.tracks : []);
      } catch (e: any) {
        if (!mounted) return;
        setError(e?.message || "Failed to load artist");
        setArtist(null);
        setPlaylists([]);
        setTracks([]);
      } finally {
        if (mounted) setLoading(false);
      }
    };

    void run();

    return () => {
      mounted = false;
      controller.abort();
    };
  }, [channelId]);

  if (loading) {
    return (
      <div className="p-4 max-w-5xl mx-auto pb-32">
        <div className="flex items-center gap-3 text-muted-foreground">
          <div className="h-5 w-5 animate-spin rounded-full border-2 border-muted-foreground/40 border-t-transparent" />
          <span>Loading artist…</span>
        </div>
      </div>
    );
  }

  if (error || !artist) {
    return (
      <div className="p-4 max-w-5xl mx-auto pb-32">
        <div className="rounded-xl border border-border bg-card/40 p-4">
          <div className="text-lg font-semibold">Artist unavailable</div>
          <div className="mt-1 text-sm text-muted-foreground">{error || "Artist not found"}</div>
        </div>
      </div>
    );
  }

  return (
    <div className="p-4 max-w-5xl mx-auto pb-32">
      {/* Artist header */}
      <div className="rounded-xl overflow-hidden border border-border bg-card/40">
        {artist.banner_url ? (
          <div className="h-44 w-full overflow-hidden">
            <img src={artist.banner_url} alt="" className="h-full w-full object-cover" />
          </div>
        ) : (
          <div className="h-24 w-full bg-muted" />
        )}

        <div className="p-4 flex items-center gap-4">
          <div className="h-16 w-16 shrink-0 overflow-hidden rounded-full bg-muted">
            {artist.thumbnail_url ? (
              <img src={artist.thumbnail_url} alt="" className="h-full w-full object-cover" />
            ) : null}
          </div>
          <div className="min-w-0">
            <div className="text-2xl font-bold truncate">{artist.artist || "Unknown artist"}</div>
          </div>
        </div>
      </div>

      {/* Playlists grid */}
      <div className="mt-6">
        <div className="text-xl font-bold mb-3">Playlists</div>
        {playlists.length === 0 ? (
          <div className="rounded-xl border border-border bg-card/40 p-4 text-sm text-muted-foreground">
            No playlists yet.
          </div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
            {playlists.map((p, idx) => (
              <div
                key={p.id || `${idx}`}
                className="rounded-xl border border-border bg-card/30 overflow-hidden"
              >
                <div className="aspect-square bg-muted">
                  {p.cover_url ? (
                    <img src={p.cover_url} alt="" className="h-full w-full object-cover" />
                  ) : null}
                </div>
                <div className="p-3">
                  <div className="text-sm font-semibold truncate">{p.title || "Untitled playlist"}</div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Tracks list */}
      <div className="mt-6">
        <div className="text-xl font-bold mb-3">Tracks</div>
        {tracks.length === 0 ? (
          <div className="rounded-xl border border-border bg-card/40 p-4 text-sm text-muted-foreground">
            No tracks yet.
          </div>
        ) : (
          <div className="rounded-xl border border-border bg-card/40 overflow-hidden">
            <div className="divide-y divide-border">
              {tracks.map((t, idx) => (
                <div key={t.id || `${idx}`} className="p-3">
                  <div className="font-medium truncate">{t.title || "Untitled"}</div>
                  <div className="text-sm text-muted-foreground truncate">{t.artist || "Unknown artist"}</div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
