import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { ArrowLeft } from "lucide-react";

import { Button } from "@/components/ui/button";
import { usePlayer } from "@/contexts/PlayerContext";
import { withBackendOrigin } from "@/lib/backendUrl";

type BrowseArtistResponse = {
  artistName: string | null;
  thumbnails?: { avatar?: string | null; banner?: string | null } | null;
  topSongs?: Array<{ id: string; title: string; youtubeId: string; artist: string; imageUrl?: string | null; playCount?: string | number | null }>;
  albums?: Array<{ id: string; title: string; imageUrl?: string | null; channelTitle?: string | null }>;
  playlists?: Array<{ id: string; title: string; imageUrl?: string | null; channelTitle?: string | null }>;
};

type NormalizedSong = {
  id: string;
  title: string;
  artist: string;
  youtubeId: string;
  imageUrl?: string | null;
  playCount?: string;
};

const looksLikeVideoId = (value: string | undefined | null): value is string => typeof value === "string" && /^[A-Za-z0-9_-]{11}$/.test(value.trim());

function formatPlayCount(playCount?: string | number | null): string | undefined {
  if (playCount === null || playCount === undefined) return undefined;
  const num = typeof playCount === "number" ? playCount : Number(String(playCount).replace(/[^0-9]/g, ""));
  if (!Number.isFinite(num) || num <= 0) return undefined;
  if (num >= 1_000_000) return `${(num / 1_000_000).toFixed(1).replace(/\.0$/, "")}M plays`;
  if (num >= 1_000) return `${(num / 1_000).toFixed(1).replace(/\.0$/, "")}K plays`;
  return `${num} plays`;
}

const isAlbumLike = (id?: string): boolean => {
  if (!id) return false;
  const value = id.trim();
  return value.startsWith("MPRE") || value.startsWith("OLAK") || (!value.startsWith("VL") && !value.startsWith("PL"));
};

export default function Artist() {
  const navigate = useNavigate();
  const { artistKey } = useParams();
  const { playCollection } = usePlayer();

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
        if (!res.ok) throw new Error(typeof (json as any)?.error === "string" ? (json as any).error : "Artist fetch failed");
        setData(json as BrowseArtistResponse);
      } catch (err: any) {
        if (err?.name === "AbortError") return;
        setError(err?.message || "Artist fetch failed");
        setData({ artistName: null, topSongs: [], albums: [], playlists: [], thumbnails: null });
      } finally {
        setLoading(false);
      }
    };

    void load();
    return () => controller.abort();
  }, [artistKey]);

  const artistName = data?.artistName?.trim() || "Artist";
  const avatar = data?.thumbnails?.avatar || null;

  const topSongs: NormalizedSong[] = useMemo(() => {
    if (!Array.isArray(data?.topSongs)) return [];
    return data.topSongs
      .map((song) => {
        if (!looksLikeVideoId(song.youtubeId)) return null;
        return {
          id: song.id,
          title: (song.title || "").trim() || "Untitled",
          artist: (song.artist || "").trim() || artistName,
          youtubeId: song.youtubeId.trim(),
          imageUrl: song.imageUrl || null,
          playCount: formatPlayCount(song.playCount),
        } as NormalizedSong;
      })
      .filter(Boolean) as NormalizedSong[];
  }, [data?.topSongs, artistName]);

  const albums = useMemo(() => {
    if (!Array.isArray(data?.albums)) return [];
    return data.albums.filter((album) => album?.id && isAlbumLike(album.id));
  }, [data?.albums]);

  const playlists = useMemo(() => {
    if (!Array.isArray(data?.playlists)) return [];
    return data.playlists.filter((pl) => pl?.id);
  }, [data?.playlists]);

  const playbackQueue = useMemo(
    () =>
      topSongs.map((song) => ({
        youtubeVideoId: song.youtubeId,
        title: song.title,
        artist: song.artist,
        thumbnailUrl: song.imageUrl || undefined,
      })),
    [topSongs],
  );

  const handlePlaySong = (index: number) => {
    if (!playbackQueue.length) return;
    playCollection(playbackQueue, index, "artist", null);
  };

  const renderTopSongs = topSongs.length > 0;
  const renderAlbums = albums.length > 0;
  const renderPlaylists = playlists.length > 0;
  const showEmpty = !renderTopSongs && !renderAlbums && !renderPlaylists;

  return (
    <div className="min-h-screen bg-neutral-950 pb-24 text-white">
      <div className="relative mx-auto max-w-5xl px-4 pt-6">
        <div className="absolute left-0 top-0">
          <Button variant="ghost" size="icon" onClick={() => navigate(-1)}>
            <ArrowLeft className="h-5 w-5" />
          </Button>
        </div>

        <div className="flex flex-col items-center gap-4 rounded-2xl border border-white/5 bg-neutral-900/70 px-6 py-8 text-center">
          <div className="h-32 w-32 overflow-hidden rounded-full border border-white/10 bg-neutral-800">
            {avatar ? <img src={avatar} alt={artistName} className="h-full w-full object-cover" /> : null}
          </div>
          <div className="space-y-1">
            <h1 className="text-3xl font-black leading-tight text-white">{artistName}</h1>
            <p className="text-sm text-white/60">Artist</p>
          </div>
        </div>

        {error ? (
          <div className="mt-6 rounded-lg border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-200">{error}</div>
        ) : null}

        {loading ? (
          <div className="mt-8 text-sm text-neutral-400">Loading artist...</div>
        ) : showEmpty ? (
          <div className="mt-10 rounded-lg border border-white/5 bg-white/5 p-4 text-sm text-neutral-300">No content available for this artist.</div>
        ) : (
          <div className="mt-10 space-y-12">
            {renderTopSongs ? (
              <section className="space-y-3">
                <h2 className="text-xl font-semibold text-white">Top Songs</h2>
                <div className="space-y-2">
                  {topSongs.map((song, index) => (
                    <button
                      key={song.id || song.youtubeId}
                      type="button"
                      onClick={() => handlePlaySong(index)}
                      className="flex w-full items-center gap-3 rounded-lg border border-white/5 bg-white/5 px-3 py-3 text-left transition hover:bg-white/10"
                    >
                      <div className="h-12 w-12 overflow-hidden rounded-md bg-neutral-800">
                        {song.imageUrl ? <img src={song.imageUrl} alt={song.title} className="h-full w-full object-cover" /> : null}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-sm font-semibold text-neutral-50">{song.title}</div>
                        <div className="truncate text-xs text-neutral-400">{song.artist}</div>
                      </div>
                      {song.playCount ? <div className="shrink-0 text-xs text-neutral-400">{song.playCount}</div> : null}
                    </button>
                  ))}
                </div>
              </section>
            ) : null}

            {renderAlbums ? (
              <section className="space-y-3">
                <h2 className="text-xl font-semibold text-white">Albums</h2>
                <div className="overflow-x-auto">
                  <div className="flex gap-4 pb-2">
                    {albums.map((album) => (
                      <button
                        key={album.id}
                        type="button"
                        onClick={() => navigate(`/playlist/${encodeURIComponent(album.id)}`)}
                        className="w-44 flex-shrink-0 overflow-hidden rounded-xl border border-white/5 bg-white/5 text-left transition hover:border-white/20 hover:bg-white/10"
                      >
                        <div className="h-44 w-full bg-neutral-800">
                          {album.imageUrl ? <img src={album.imageUrl} alt={album.title} className="h-full w-full object-cover" /> : null}
                        </div>
                        <div className="space-y-1 p-3">
                          <div className="truncate text-sm font-semibold text-neutral-50">{album.title}</div>
                          {album.channelTitle ? <div className="truncate text-xs text-neutral-400">{album.channelTitle}</div> : null}
                        </div>
                      </button>
                    ))}
                  </div>
                </div>
              </section>
            ) : null}

            {renderPlaylists ? (
              <section className="space-y-3">
                <h2 className="text-xl font-semibold text-white">Playlists</h2>
                <div className="overflow-x-auto">
                  <div className="flex gap-4 pb-2">
                    {playlists.map((pl) => (
                      <button
                        key={pl.id}
                        type="button"
                        onClick={() => navigate(`/playlist/${encodeURIComponent(pl.id)}`)}
                        className="w-44 flex-shrink-0 overflow-hidden rounded-xl border border-white/5 bg-white/5 text-left transition hover:border-white/20 hover:bg-white/10"
                      >
                        <div className="h-44 w-full bg-neutral-800">
                          {pl.imageUrl ? <img src={pl.imageUrl} alt={pl.title} className="h-full w-full object-cover" /> : null}
                        </div>
                        <div className="space-y-1 p-3">
                          <div className="truncate text-sm font-semibold text-neutral-50">{pl.title}</div>
                          {pl.channelTitle ? <div className="truncate text-xs text-neutral-400">{pl.channelTitle}</div> : null}
                        </div>
                      </button>
                    ))}
                  </div>
                </div>
              </section>
            ) : null}
          </div>
        )}
      </div>
    </div>
  );
}
