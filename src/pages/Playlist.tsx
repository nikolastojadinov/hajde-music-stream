import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { ArrowLeft, Play, Shuffle } from "lucide-react";

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
  durationSeconds?: number;
};

const isVideoId = (value: string | undefined | null): value is string => typeof value === "string" && /^[A-Za-z0-9_-]{11}$/.test(value.trim());

function pickFirstThumbnail(input?: string | string[] | { cover?: string | null } | null): string | null {
  if (!input) return null;
  if (typeof input === "string") return input;
  if (Array.isArray(input)) return input.find((t) => t)?.toString() || null;
  if (typeof input === "object" && "cover" in input) return input.cover || null;
  return null;
}

function parseDurationToSeconds(duration: number | string | null | undefined): number | null {
  if (typeof duration === "number" && Number.isFinite(duration)) return Math.max(0, Math.trunc(duration));
  if (typeof duration === "string" && duration.trim()) {
    const parts = duration.split(":").map((p) => Number(p));
    if (parts.some((n) => Number.isNaN(n))) return null;
    if (parts.length === 3) return Math.max(0, parts[0] * 3600 + parts[1] * 60 + parts[2]);
    if (parts.length === 2) return Math.max(0, parts[0] * 60 + parts[1]);
  }
  return null;
}

function formatDuration(duration: number | string | null | undefined): { label?: string; seconds?: number } {
  const seconds = parseDurationToSeconds(duration);
  if (seconds !== null) {
    const mins = Math.floor(seconds / 60);
    const secs = (seconds % 60).toString().padStart(2, "0");
    return { label: `${mins}:${secs}`, seconds };
  }
  if (typeof duration === "string" && duration.trim()) return { label: duration.trim(), seconds: null };
  return { label: undefined, seconds: null };
}

function formatTotalDuration(seconds: number): string {
  const hrs = Math.floor(seconds / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  if (hrs > 0) return `${hrs} hr ${mins} min`;
  return `${mins} min`;
}

export default function Playlist() {
  const { id: routeId, browseId: altBrowseId } = useParams();
  const browseId = (altBrowseId || routeId || "").trim();
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
        const typed = json as BrowsePlaylistResponse;
        setData(typed);
      } catch (err: any) {
        if (err?.name === "AbortError") return;
        setError(err?.message || "Playlist fetch failed");
        setData({ title: null, tracks: [] });
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
        const duration = formatDuration(t.duration);
        return {
          videoId: t.videoId.trim(),
          title: (t.title || "").trim(),
          artist: (t.artist || "").trim(),
          artistId: t.artistId || null,
          thumbnail: pickFirstThumbnail(t.thumbnails),
          durationLabel: duration.label,
          durationSeconds: duration.seconds ?? undefined,
        } satisfies NormalizedTrack;
      })
      .filter(Boolean) as NormalizedTrack[];
  }, [data?.tracks]);

  const coverImage = pickFirstThumbnail(data?.thumbnails) || tracks[0]?.thumbnail || null;
  const title = (data?.title || "").trim() || "Playlist";
  const subtitle = data?.description?.trim();
  const totalDurationSeconds = tracks.reduce((acc, t) => (typeof t.durationSeconds === "number" ? acc + t.durationSeconds : acc), 0);
  const totalDurationLabel = totalDurationSeconds > 0 ? formatTotalDuration(totalDurationSeconds) : null;

  const playbackQueue = useMemo(
    () => tracks.map((t) => ({ youtubeVideoId: t.videoId, title: t.title, artist: t.artist, thumbnailUrl: t.thumbnail || undefined })),
    [tracks],
  );

  const handlePlayAll = () => {
    if (!playbackQueue.length) return;
    playCollection(playbackQueue, 0, "playlist", browseId || null);
  };

  const handleShufflePlay = () => {
    if (!playbackQueue.length) return;
    const randomIndex = Math.floor(Math.random() * playbackQueue.length);
    playCollection(playbackQueue, randomIndex, "playlist", browseId || null);
  };

  const handlePlayTrack = (index: number) => {
    if (!playbackQueue.length) return;
    playCollection(playbackQueue, index, "playlist", browseId || null);
  };

  const handleArtistNavigate = (artistId?: string | null) => {
    if (!artistId) return;
    navigate(`/artist/${encodeURIComponent(artistId)}`);
  };

  const handleReload = () => setReloadKey((x) => x + 1);

  const loadingView = (
    <div className="min-h-screen bg-gradient-to-b from-neutral-950 via-neutral-950 to-black text-white">
      <div className="mx-auto max-w-6xl px-4 py-12 text-sm text-neutral-400">Loading playlist...</div>
    </div>
  );

  if (loading) return loadingView;

  return (
    <div className="min-h-screen bg-gradient-to-b from-neutral-950 via-neutral-950 to-black text-white">
      <div className="relative mx-auto max-w-6xl px-4 pb-24">
        <div className="sticky top-0 z-10 -mx-4 mb-6 flex items-center gap-3 bg-gradient-to-b from-neutral-950/90 via-neutral-950/80 to-transparent px-4 py-4 backdrop-blur md:static md:bg-transparent md:px-0">
          <button
            type="button"
            aria-label="Back"
            onClick={() => navigate(-1)}
            className="flex h-10 w-10 items-center justify-center rounded-full border border-white/10 bg-white/5 hover:bg-white/10"
          >
            <ArrowLeft className="h-5 w-5" />
          </button>
          <div className="hidden text-sm text-neutral-400 md:block">Playlist</div>
          <div className="truncate text-base font-semibold text-white md:text-lg">{title}</div>
        </div>

        <div className="relative overflow-hidden rounded-2xl border border-white/10 bg-gradient-to-br from-neutral-900/90 via-neutral-900/70 to-black shadow-2xl">
          <div className="absolute inset-0 opacity-40 blur-3xl" aria-hidden="true">
            {coverImage ? <img src={coverImage} alt="" className="h-full w-full object-cover" /> : null}
          </div>

          <div className="relative flex flex-col gap-6 p-6 md:flex-row md:items-center md:gap-8 md:p-10">
            <div className="h-64 w-64 overflow-hidden rounded-xl border border-white/15 bg-neutral-900 shadow-xl">
              {coverImage ? <img src={coverImage} alt={title} className="h-full w-full object-cover" /> : null}
            </div>

            <div className="flex flex-1 flex-col gap-4">
              <div className="text-xs uppercase tracking-[0.3em] text-white/70">Playlist</div>
              <h1 className="text-3xl font-black leading-tight text-white sm:text-4xl">{title}</h1>
              <div className="flex flex-wrap items-center gap-3 text-sm text-neutral-300">
                <span className="font-semibold text-white">YouTube Music</span>
                <span className="h-1 w-1 rounded-full bg-neutral-500" aria-hidden="true" />
                <span>{tracks.length} songs</span>
                {totalDurationLabel ? (
                  <>
                    <span className="h-1 w-1 rounded-full bg-neutral-500" aria-hidden="true" />
                    <span>{totalDurationLabel}</span>
                  </>
                ) : null}
              </div>
              {subtitle ? <p className="max-w-2xl text-sm text-neutral-300">{subtitle}</p> : null}

              <div className="flex flex-wrap items-center gap-3 pt-2">
                <button
                  type="button"
                  onClick={handlePlayAll}
                  disabled={!playbackQueue.length}
                  className="flex h-14 w-14 items-center justify-center rounded-full bg-white text-neutral-900 shadow-lg transition hover:scale-105 disabled:cursor-not-allowed disabled:opacity-50"
                  aria-label="Play playlist"
                >
                  <Play className="h-7 w-7" />
                </button>
                <button
                  type="button"
                  onClick={handleShufflePlay}
                  disabled={!playbackQueue.length}
                  className="flex h-12 items-center gap-2 rounded-full border border-white/20 bg-white/10 px-4 text-sm font-semibold text-white hover:bg-white/20 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <Shuffle className="h-4 w-4" /> Shuffle
                </button>
                <button
                  type="button"
                  onClick={handleReload}
                  className="flex h-12 items-center rounded-full border border-white/10 bg-white/5 px-4 text-sm text-white/80 hover:bg-white/10"
                >
                  Refresh
                </button>
              </div>
            </div>
          </div>
        </div>

        {error ? (
          <div className="mt-6 rounded-xl border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-100">{error}</div>
        ) : null}

        <div className="mt-8 rounded-2xl border border-white/10 bg-black/60 shadow-2xl">
          {tracks.length === 0 ? (
            <div className="px-6 py-10 text-center text-sm text-neutral-400">No tracks available for this playlist.</div>
          ) : (
            <div className="divide-y divide-white/5">
              {tracks.map((track, index) => (
                <button
                  key={track.videoId}
                  type="button"
                  onClick={() => handlePlayTrack(index)}
                  className="flex w-full items-center gap-4 px-6 py-4 text-left transition hover:bg-white/5"
                >
                  <div className="w-6 shrink-0 text-center text-xs font-semibold text-neutral-400">{index + 1}</div>
                  <div className="h-14 w-14 overflow-hidden rounded-md bg-neutral-800 shadow-inner">
                    {track.thumbnail ? <img src={track.thumbnail} alt={track.title} className="h-full w-full object-cover" loading="lazy" /> : null}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-semibold text-white">{track.title || "Unknown title"}</div>
                    <div className="truncate text-xs text-neutral-400">
                      {track.artistId ? (
                        <span
                          className="hover:text-white"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleArtistNavigate(track.artistId || undefined);
                          }}
                        >
                          {track.artist || "Unknown artist"}
                        </span>
                      ) : (
                        track.artist || "Unknown artist"
                      )}
                    </div>
                  </div>
                  <div className="shrink-0 text-xs tabular-nums text-neutral-300">{track.durationLabel || ""}</div>
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="mt-10 rounded-2xl border border-white/10 bg-white/5 px-6 py-6 text-white">
          <div className="mb-4 text-lg font-semibold">Related playlists</div>
          <div className="text-sm text-neutral-300">No related playlists available yet.</div>
        </div>
      </div>
    </div>
  );
}
