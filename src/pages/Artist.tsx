import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { ArrowLeft } from "lucide-react";

import { Button } from "@/components/ui/button";
import ErrorState from "@/components/ui/ErrorState";
import { withBackendOrigin } from "@/lib/backendUrl";

type BrowseArtistResponse = {
  artistName: string | null;
  thumbnails: { avatar: string | null; banner: string | null } | null;
  topSongs: Array<{ id: string; title: string; youtubeId: string; artist: string; imageUrl?: string | null }>;
  albums: Array<{ id: string; title: string; imageUrl?: string | null; channelTitle?: string | null }>;
};

function isAlbumBrowseId(id: string): boolean {
  const value = id.trim();
  return value.startsWith("MPRE") || value.startsWith("OLAK") || (!value.startsWith("VL") && !value.startsWith("PL"));
}

export default function Artist() {
  const navigate = useNavigate();
  const { artistKey } = useParams();

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<BrowseArtistResponse | null>(null);

  useEffect(() => {
    if (!artistKey) return;

    const controller = new AbortController();
    const load = async () => {
      setLoading(true);
      setError(null);
      try {
        const url = withBackendOrigin(`/api/browse/artist?browseId=${encodeURIComponent(artistKey)}`);
        const res = await fetch(url, {
          method: "GET",
          headers: { Accept: "application/json" },
          credentials: "include",
          signal: controller.signal,
        });
        const json = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(typeof json?.error === "string" ? json.error : "Artist fetch failed");
        setData(json as BrowseArtistResponse);
      } catch (err: any) {
        if (err?.name === "AbortError") return;
        setError(err?.message || "Artist fetch failed");
        setData(null);
      } finally {
        setLoading(false);
      }
    };

    void load();
    return () => controller.abort();
  }, [artistKey]);

  if (loading) {
    return <div className="p-6 text-sm text-neutral-400">Loading artist...</div>;
  }

  if (error) {
    return (
      <div className="p-6">
        <ErrorState title="Artist request failed" subtitle={error} onRetry={() => {}} />
      </div>
    );
  }

  const artistName = data?.artistName || "Artist";
  const avatar = data?.thumbnails?.avatar || null;
  const banner = data?.thumbnails?.banner || null;
  const topSongs = Array.isArray(data?.topSongs) ? data!.topSongs : [];
  const albums = Array.isArray(data?.albums) ? data!.albums.filter((a) => a?.id && isAlbumBrowseId(a.id)) : [];

  const showEmpty = topSongs.length === 0 && albums.length === 0;

  return (
    <div className="min-h-screen bg-neutral-950 pb-24 text-white">
      <div className="relative mx-auto max-w-5xl px-4 pt-6">
        <div className="absolute left-0 top-0">
          <Button variant="ghost" size="icon" onClick={() => navigate(-1)}>
            <ArrowLeft className="h-5 w-5" />
          </Button>
        </div>

        <div className="overflow-hidden rounded-2xl border border-white/5 bg-neutral-900/60">
          {banner ? (
            <div className="h-48 w-full overflow-hidden bg-neutral-900">
              <img src={banner} alt={artistName} className="h-full w-full object-cover" />
            </div>
          ) : null}

          <div className="flex flex-col items-center gap-4 px-6 py-6 text-center">
            <div className="h-28 w-28 overflow-hidden rounded-full border border-white/10 bg-neutral-800">
              {avatar ? <img src={avatar} alt={artistName} className="h-full w-full object-cover" /> : null}
            </div>
            <div className="space-y-1">
              <h1 className="text-3xl font-black leading-tight">{artistName}</h1>
              <p className="text-sm text-neutral-400">Artist</p>
            </div>
          </div>
        </div>

        {showEmpty ? (
          <div className="mt-10 rounded-lg border border-white/5 bg-white/5 p-4 text-sm text-neutral-300">
            No content available for this artist.
          </div>
        ) : (
          <div className="mt-10 space-y-10">
            {topSongs.length > 0 ? (
              <section className="space-y-3">
                <h2 className="text-xl font-semibold text-neutral-100">Top Songs</h2>
                <div className="space-y-2">
                  {topSongs.map((song) => (
                    <div
                      key={song.id}
                      className="flex items-center gap-3 rounded-lg border border-white/5 bg-neutral-900/60 px-3 py-2"
                    >
                      <div className="h-12 w-12 overflow-hidden rounded-md bg-neutral-800">
                        {song.imageUrl ? <img src={song.imageUrl} alt={song.title} className="h-full w-full object-cover" /> : null}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-sm font-semibold text-neutral-50">{song.title}</div>
                        <div className="truncate text-xs text-neutral-400">{song.artist}</div>
                      </div>
                    </div>
                  ))}
                </div>
              </section>
            ) : null}

            {albums.length > 0 ? (
              <section className="space-y-3">
                <h2 className="text-xl font-semibold text-neutral-100">Albums</h2>
                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                  {albums.map((album) => (
                    <button
                      key={album.id}
                      type="button"
                      onClick={() => navigate(`/playlist/${encodeURIComponent(album.id)}`)}
                      className="flex flex-col overflow-hidden rounded-xl border border-white/5 bg-neutral-900/60 text-left hover:border-white/20"
                    >
                      <div className="h-44 w-full bg-neutral-800">
                        {album.imageUrl ? (
                          <img src={album.imageUrl} alt={album.title} className="h-full w-full object-cover" />
                        ) : null}
                      </div>
                      <div className="p-3">
                        <div className="truncate text-sm font-semibold text-neutral-50">{album.title}</div>
                        {album.channelTitle ? (
                          <div className="truncate text-xs text-neutral-400">{album.channelTitle}</div>
                        ) : null}
                      </div>
                    </button>
                  ))}
                </div>
              </section>
            ) : null}
          </div>
        )}
      </div>
    </div>
  );
}
