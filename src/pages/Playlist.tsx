import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { ArrowLeft, Play } from "lucide-react";

import { Button } from "@/components/ui/button";
import ErrorState from "@/components/ui/ErrorState";
import { usePlayer } from "@/contexts/PlayerContext";
import { withBackendOrigin } from "@/lib/backendUrl";

type PlaylistTrack = {
  videoId: string;
  title: string;
  artist?: string | null;
  artistId?: string | null;
  duration?: number | string | null;
  thumbnails?: string | string[] | null;
};

type BrowsePlaylistResponse = {
  title: string | null;
  description?: string | null;
  thumbnails?: { cover?: string | null } | string | null;
  tracks: PlaylistTrack[];
};

type NormalizedTrack = {
  videoId: string;
  title: string;
  artist: string;
  artistId?: string | null;
  thumbnail?: string | null;
  durationLabel?: string;
};

const isVideoId = (value: string | undefined | null): value is string => typeof value === "string" && /^[A-Za-z0-9_-]{11}$/.test(value.trim());

function pickFirstThumbnail(input?: string | string[] | { cover?: string | null } | null): string | null {
  if (!input) return null;
  if (typeof input === "string") return input;
  if (Array.isArray(input)) return input.find((t) => t)?.toString() || null;
  if (typeof input === "object" && "cover" in input) return input.cover || null;
  return null;
}

function formatDuration(duration: number | string | null | undefined): string | undefined {
  if (typeof duration === "number" && Number.isFinite(duration)) {
    const total = Math.max(0, Math.trunc(duration));
    const minutes = Math.floor(total / 60);
    const seconds = (total % 60).toString().padStart(2, "0");
    return `${minutes}:${seconds}`;
  }
  if (typeof duration === "string" && duration.trim()) return duration.trim();
  return undefined;
}

export default function Playlist() {
  const { browseId } = useParams();
  const navigate = useNavigate();
  const { playCollection } = usePlayer();

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<BrowsePlaylistResponse | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    if (!browseId) return;

    const controller = new AbortController();

    const load = async () => {
      setLoading(true);
      setError(null);
      try {
        const url = withBackendOrigin(`/api/browse/playlist?browseId=${encodeURIComponent(browseId)}`);
        const res = await fetch(url, {
          method: "GET",
          headers: { Accept: "application/json" },
          credentials: "include",
          signal: controller.signal,
        });
        const json = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(typeof json?.error === "string" ? json.error : "Playlist fetch failed");
        setData(json as BrowsePlaylistResponse);
      } catch (err: any) {
        if (err?.name === "AbortError") return;
        setError(err?.message || "Playlist fetch failed");
        setData(null);
      } finally {
        setLoading(false);
      }
    };

    void load();
    return () => controller.abort();
  }, [browseId, reloadKey]);

  const tracks: NormalizedTrack[] = useMemo(() => {
    if (!Array.isArray(data?.tracks)) return [];
    return data.tracks
      .map((t) => {
        if (!isVideoId(t.videoId)) return null;
        const title = (t.title || "").trim();
        const artist = (t.artist || "").trim();
        if (!title || !artist) return null;
        return {
          videoId: t.videoId.trim(),
          title,
          artist,
          artistId: t.artistId || null,
          thumbnail: pickFirstThumbnail(t.thumbnails),
          durationLabel: formatDuration(t.duration),
        } satisfies NormalizedTrack;
      })
      .filter(Boolean) as NormalizedTrack[];
  }, [data?.tracks]);

  const coverImage = pickFirstThumbnail(data?.thumbnails) || tracks[0]?.thumbnail || null;
  const title = (data?.title || "").trim() || "Playlist";
  const subtitle = data?.description?.trim() || "Playlist";

  const playbackQueue = useMemo(
    () => tracks.map((t) => ({ youtubeVideoId: t.videoId, title: t.title, artist: t.artist, thumbnailUrl: t.thumbnail || undefined })),
    [tracks],
  );

  const handlePlayAll = () => {
    if (!playbackQueue.length) return;
    playCollection(playbackQueue, 0, "playlist", browseId || null);
  };

  const handlePlayTrack = (index: number) => {
    if (!playbackQueue.length) return;
    playCollection(playbackQueue, index, "playlist", browseId || null);
  };

  const handleArtistNavigate = (artistId?: string | null) => {
    if (!artistId) return;
    navigate(`/artist/${encodeURIComponent(artistId)}`);
  };

  if (loading) {
    return <div className="p-6 text-sm text-neutral-400">Loading playlist...</div>;
  }

  if (error) {
    return (
      <div className="p-6">
        <ErrorState title="Playlist request failed" subtitle={error} onRetry={() => setReloadKey((key) => key + 1)} />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-neutral-950 pb-24 text-white">
      <div className="relative mx-auto max-w-5xl px-4 pt-6">
        <div className="absolute left-0 top-0">
          <Button variant="ghost" size="icon" onClick={() => navigate(-1)}>
            <ArrowLeft className="h-5 w-5" />
          </Button>
        </div>

        <div className="flex flex-col gap-6 md:flex-row md:items-end md:gap-8">
          <div className="h-56 w-56 overflow-hidden rounded-xl border border-white/10 bg-neutral-900">
            {coverImage ? <img src={coverImage} alt={title} className="h-full w-full object-cover" /> : null}
          </div>

          <div className="flex flex-1 flex-col gap-3 pb-2">
            <p className="text-xs uppercase tracking-[0.25em] text-white/60">Playlist</p>
            <h1 className="text-3xl font-black leading-tight text-white">{title}</h1>
            {subtitle ? <p className="text-sm text-white/70">{subtitle}</p> : null}

            <div className="flex flex-wrap items-center gap-3 pt-1">
              <button className="pm-cta-pill" onClick={handlePlayAll} disabled={!playbackQueue.length}>
                <span className="pm-cta-pill-inner">
                  <Play className="h-5 w-5" />
                  Play all
                </span>
              </button>
              <span className="text-sm text-white/70">{tracks.length} tracks</span>
            </div>
          </div>
        </div>

        <div className="mt-10 space-y-2">
          {tracks.length === 0 ? (
            <div className="rounded-lg border border-white/5 bg-white/5 p-4 text-sm text-neutral-300">No tracks available</div>
          ) : (
            tracks.map((track, index) => (
              <button
                key={track.videoId}
                type="button"
                onClick={() => handlePlayTrack(index)}
                className="flex w-full items-center gap-3 rounded-lg border border-white/5 bg-white/5 px-3 py-3 text-left hover:bg-white/10"
              >
                <div className="w-6 shrink-0 text-center text-xs text-neutral-500">{index + 1}</div>
                <div className="h-12 w-12 overflow-hidden rounded-md bg-neutral-800">
                  {track.thumbnail ? <img src={track.thumbnail} alt={track.title} className="h-full w-full object-cover" /> : null}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-semibold text-neutral-50">{track.title}</div>
                  <div className="truncate text-xs text-neutral-400">
                    {track.artistId ? (
                      <span
                        className="hover:text-white"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleArtistNavigate(track.artistId || undefined);
                        }}
                      >
                        {track.artist}
                      </span>
                    ) : (
                      track.artist
                    )}
                  </div>
                </div>
                <div className="shrink-0 text-xs text-neutral-400 tabular-nums">{track.durationLabel}</div>
              </button>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
