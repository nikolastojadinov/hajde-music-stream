import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { ArrowLeft, MoreVertical } from "lucide-react";

import { Button } from "@/components/ui/button";
import { usePlayer } from "@/contexts/PlayerContext";
import { withBackendOrigin } from "@/lib/backendUrl";

type BrowseArtistResponse = {
  artistName: string | null;
  thumbnails?: { avatar?: string | null; banner?: string | null } | null;
  topSongs?: Array<{ id: string; title: string; imageUrl?: string | null; playCount?: string | null }>;
  albums?: Array<{ id: string; title: string; imageUrl?: string | null; year?: string | null }>;
  playlists?: Array<{ id: string; title: string; imageUrl?: string | null }>;
};

type NormalizedSong = {
  id: string;
  title: string;
  artist: string;
  imageUrl: string | null;
  playCount: string | null;
};

type NormalizedCollection = {
  id: string;
  title: string;
  imageUrl: string | null;
  year?: string | null;
};

const looksLikeVideoId = (value: string | undefined | null): value is string => typeof value === "string" && /^[A-Za-z0-9_-]{11}$/.test(value.trim());

const normalizeString = (value: unknown): string => (typeof value === "string" ? value.trim() : "");

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
        setData({ artistName: null, thumbnails: null, topSongs: [], albums: [], playlists: [] });
      } finally {
        setLoading(false);
      }
    };

    void load();
    return () => controller.abort();
  }, [artistKey]);

  const artistName = data?.artistName?.trim() || "Artist";
  const avatar = data?.thumbnails?.avatar || null;

  const songs: NormalizedSong[] = useMemo(() => {
    const source = Array.isArray(data?.topSongs) ? data.topSongs : [];
    return source.slice(0, 5).map((song) => ({
      id: song.id,
      title: normalizeString(song.title) || "Untitled",
      artist: artistName,
      imageUrl: song.imageUrl ?? null,
      playCount: song.playCount ?? null,
    }));
  }, [data?.topSongs, artistName]);

  const playbackQueue = useMemo(
    () =>
      songs.map((song) => ({
        youtubeVideoId: looksLikeVideoId(song.id) ? song.id : normalizeString(song.id),
        title: song.title,
        artist: song.artist,
        thumbnailUrl: song.imageUrl || undefined,
      })),
    [songs],
  );

  const albums: NormalizedCollection[] = useMemo(
    () =>
      (Array.isArray(data?.albums) ? data!.albums : []).map((item) => ({
        id: item.id,
        title: normalizeString(item.title) || "Album",
        imageUrl: item.imageUrl ?? null,
        year: item.year ?? null,
      })),
    [data?.albums],
  );

  const playlists: NormalizedCollection[] = useMemo(
    () =>
      (Array.isArray(data?.playlists) ? data!.playlists : []).map((item) => ({
        id: item.id,
        title: normalizeString(item.title) || "Playlist",
        imageUrl: item.imageUrl ?? null,
      })),
    [data?.playlists],
  );

  const handlePlaySong = (index: number) => {
    if (!playbackQueue.length) return;
    playCollection(playbackQueue, index, "artist", null);
  };

  return (
    <div className="min-h-screen bg-neutral-950 pb-24 text-white">
      <div className="relative mx-auto max-w-5xl px-4 pt-6">
        <div className="absolute left-0 top-0">
          <Button variant="ghost" size="icon" onClick={() => navigate(-1)}>
            <ArrowLeft className="h-5 w-5" />
          </Button>
        </div>

        <div className="flex flex-col items-center gap-3 rounded-2xl border border-white/5 bg-neutral-900/70 px-6 py-8 text-center">
          <div className="h-[72px] w-[72px] overflow-hidden rounded-full border border-white/10 bg-neutral-800 md:h-24 md:w-24">
            {avatar ? <img src={avatar} alt={artistName} className="h-full w-full object-cover" /> : null}
          </div>
          <div className="space-y-1">
            <h1 className="text-3xl font-black leading-tight text-white md:text-4xl">{artistName}</h1>
            <p className="text-sm text-white/70">Artist</p>
          </div>
        </div>

        {error ? <div className="mt-6 rounded-lg border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-200">{error}</div> : null}

        {loading ? (
          <div className="mt-8 text-sm text-neutral-400">Loading artist...</div>
        ) : (
          <div className="mt-10 space-y-8 md:space-y-10">
            {songs.length > 0 ? (
              <section className="space-y-4">
                <h2 className="text-lg font-semibold text-white md:text-xl">Popular songs</h2>
                <div className="space-y-3">
                  {songs.map((song, index) => (
                    <button
                      key={`${song.id}-${index}`}
                      type="button"
                      onClick={() => handlePlaySong(index)}
                      className="flex h-14 w-full items-center gap-3 rounded-lg border border-white/5 bg-white/5 px-3 text-left transition hover:bg-white/10"
                    >
                      <div className="h-12 w-12 shrink-0 overflow-hidden rounded-md bg-neutral-800">
                        {song.imageUrl ? <img src={song.imageUrl} alt={song.title} className="h-full w-full object-cover" /> : null}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-sm font-semibold text-white">{song.title}</div>
                        <div className="truncate text-xs text-white/65">{song.artist}</div>
                        {song.playCount ? <div className="truncate text-[11px] text-white/50">{song.playCount}</div> : null}
                      </div>
                      <MoreVertical className="h-4 w-4 text-white/65" />
                    </button>
                  ))}
                </div>
              </section>
            ) : null}

            {albums.length > 0 ? (
              <section className="space-y-4">
                <h2 className="text-lg font-semibold text-white md:text-xl">Albums</h2>
                <div className="overflow-x-auto pb-1">
                  <div className="flex gap-4">
                    {albums.map((album) => (
                      <button
                        key={album.id}
                        type="button"
                        onClick={() => navigate(`/playlist/${encodeURIComponent(album.id)}`)}
                        className="w-40 flex-shrink-0 text-left"
                      >
                        <div className="overflow-hidden rounded-[10px] border border-white/5 bg-neutral-800" style={{ width: 160, height: 160 }}>
                          {album.imageUrl ? <img src={album.imageUrl} alt={album.title} className="h-full w-full object-cover" /> : null}
                        </div>
                        <div className="mt-2 space-y-1" style={{ width: 160 }}>
                          <div className="truncate text-sm font-semibold text-white">{album.title}</div>
                          {album.year ? <div className="truncate text-xs text-white/65">{album.year}</div> : null}
                        </div>
                      </button>
                    ))}
                  </div>
                </div>
              </section>
            ) : null}

            {playlists.length > 0 ? (
              <section className="space-y-4">
                <h2 className="text-lg font-semibold text-white md:text-xl">Playlists</h2>
                <div className="overflow-x-auto pb-1">
                  <div className="flex gap-4">
                    {playlists.map((pl) => (
                      <button
                        key={pl.id}
                        type="button"
                        onClick={() => navigate(`/playlist/${encodeURIComponent(pl.id)}`)}
                        className="w-40 flex-shrink-0 text-left"
                      >
                        <div className="overflow-hidden rounded-[10px] border border-white/5 bg-neutral-800" style={{ width: 160, height: 160 }}>
                          {pl.imageUrl ? <img src={pl.imageUrl} alt={pl.title} className="h-full w-full object-cover" /> : null}
                        </div>
                        <div className="mt-2 space-y-1" style={{ width: 160 }}>
                          <div className="truncate text-sm font-semibold text-white">{pl.title}</div>
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
