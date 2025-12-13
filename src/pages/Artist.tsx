import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { externalSupabase } from "@/lib/externalSupabase";
import { usePlayer } from "@/contexts/PlayerContext";

type ArtistRow = {
  id: string;
  artist: string;
  artist_key: string;
  youtube_channel_id: string | null;
  description: string | null;
  thumbnail_url: string | null;
  banner_url: string | null;
  subscribers: number | null;
  views: number | null;
  country: string | null;
  source: string;
};

type Track = {
  id: string;
  external_id: string;
  title: string;
  artist: string;
  cover_url: string | null;
  duration: number | null;
};

const normalizeKey = (s: string) =>
  s
    .toLowerCase()
    .trim()
    .replace(/['"]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");

export default function Artist() {
  const { artistKey = "" } = useParams<{ artistKey: string }>();
  const key = useMemo(() => normalizeKey(artistKey), [artistKey]);
  const navigate = useNavigate();
  const { playTrack } = usePlayer();

  const [loading, setLoading] = useState(true);
  const [artist, setArtist] = useState<ArtistRow | null>(null);
  const [tracks, setTracks] = useState<Track[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!key) return;

    let cancelled = false;

    const run = async () => {
      setLoading(true);
      setError(null);

      try {
        // 1) fetch artist from backend (DB-first, else YouTube + store)
        const base = import.meta.env.VITE_BACKEND_URL as string | undefined;
        if (!base) {
          throw new Error("Missing VITE_BACKEND_URL on frontend");
        }

        const res = await fetch(`${base}/api/artist/${key}`, { method: "GET" });
        const json = await res.json();
        if (!res.ok) throw new Error(json?.error || "Failed to load artist");

        const a: ArtistRow = json.artist;
        if (!cancelled) setArtist(a);

        // 2) load local tracks for this artist (from Supabase)
        // NOTE: your DB uses track.artist as string
        const { data: localTracks, error: tErr } = await externalSupabase
          .from("tracks")
          .select("id, external_id, title, artist, cover_url, duration")
          .ilike("artist", `%${a.artist}%`)
          .limit(50);

        if (tErr) console.error("artist tracks error:", tErr);
        if (!cancelled) setTracks((localTracks as any) || []);
      } catch (e: any) {
        if (!cancelled) setError(e?.message || "Artist page failed");
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    run();

    return () => {
      cancelled = true;
    };
  }, [key]);

  const handlePlay = (t: Track) => {
    playTrack(t.external_id, t.title, t.artist, t.id);
  };

  if (loading) {
    return (
      <div className="p-4 max-w-4xl mx-auto pb-32">
        <p className="text-muted-foreground">Loading artist…</p>
      </div>
    );
  }

  if (error || !artist) {
    return (
      <div className="p-4 max-w-4xl mx-auto pb-32">
        <p className="text-red-400">{error || "Artist not found"}</p>
      </div>
    );
  }

  return (
    <div className="p-4 max-w-4xl mx-auto pb-32">
      {/* header */}
      <div className="rounded-xl overflow-hidden border border-border bg-card/40">
        {artist.banner_url ? (
          <div className="h-40 w-full overflow-hidden">
            <img src={artist.banner_url} className="w-full h-full object-cover" />
          </div>
        ) : (
          <div className="h-20 w-full bg-muted" />
        )}

        <div className="p-4 flex gap-4 items-center">
          <div className="w-20 h-20 rounded-full overflow-hidden bg-muted shrink-0">
            {artist.thumbnail_url ? (
              <img
                src={artist.thumbnail_url}
                className="w-full h-full object-cover"
                alt={artist.artist}
              />
            ) : null}
          </div>

          <div className="min-w-0">
            <div className="text-2xl font-black truncate">{artist.artist}</div>
            <div className="text-sm text-muted-foreground">
              {artist.subscribers ? `${artist.subscribers.toLocaleString()} subscribers` : " "}
            </div>

            {artist.youtube_channel_id && (
              <div className="mt-2">
                <a
                  href={`https://www.youtube.com/channel/${artist.youtube_channel_id}`}
                  target="_blank"
                  rel="noreferrer"
                  className="text-xs underline text-muted-foreground"
                >
                  Open YouTube channel
                </a>
              </div>
            )}
          </div>
        </div>

        {artist.description ? (
          <div className="px-4 pb-4 text-sm text-muted-foreground line-clamp-4">
            {artist.description}
          </div>
        ) : null}
      </div>

      {/* songs */}
      <div className="mt-6">
        <div className="text-xl font-bold mb-3">Songs</div>
        {tracks.length === 0 ? (
          <p className="text-muted-foreground">No local songs yet.</p>
        ) : (
          <div className="space-y-2">
            {tracks.map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => handlePlay(t)}
                className="w-full text-left p-3 rounded-lg border border-border bg-card/30 hover:bg-card/50 transition-colors"
              >
                <div className="font-medium truncate">{t.title}</div>
                <div className="text-sm text-muted-foreground truncate">{t.artist}</div>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* back */}
      <div className="mt-8">
        <button
          type="button"
          onClick={() => navigate(-1)}
          className="text-sm underline text-muted-foreground"
        >
          Back
        </button>
      </div>
    </div>
  );
}
