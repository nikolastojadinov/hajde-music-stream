import { useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";

import { PlaylistHeader } from "@/components/PlaylistHeader";
import { TrackRow } from "@/components/TrackRow";
import { usePlayer } from "@/contexts/PlayerContext";
import { getBackendHeaders } from "@/contexts/PiContext";
import { withBackendOrigin } from "@/lib/backendUrl";

// We reuse the browse/playlist endpoint because it supports albums (MPRE* IDs).
type AlbumApiResponse = {
  id: string;
  title: string;
  subtitle: string;
  thumbnail: string | null;
  tracks: Array<{ videoId: string; title: string; artist: string; duration: string; thumbnail: string | null }>;
};

type LocationSnapshot = {
  snapshot?: {
    title?: string;
    subtitle?: string | null;
    imageUrl?: string | null;
  };
};

const normalize = (value: unknown): string => (typeof value === "string" ? value.trim() : "");

const isVideoId = (value: string | undefined | null): value is string => typeof value === "string" && /^[A-Za-z0-9_-]{11}$/.test(value.trim());

export default function AlbumPage() {
  const { id } = useParams();
  const albumId = normalize(id);
  const navigate = useNavigate();
  const location = useLocation();
  const { playCollection } = usePlayer();

  const bootstrapRanRef = useRef(false);

  const state = (location.state || {}) as LocationSnapshot;
  const snapshotTitle = normalize(state.snapshot?.title);
  const snapshotSubtitle = normalize(state.snapshot?.subtitle);
  const snapshotImage = state.snapshot?.imageUrl ?? null;

  const [meta, setMeta] = useState<{ title: string; subtitle: string; thumbnail: string | null }>({
    title: snapshotTitle || albumId,
    subtitle: snapshotSubtitle,
    thumbnail: snapshotImage,
  });
  const [tracks, setTracks] = useState<AlbumApiResponse["tracks"]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!albumId || bootstrapRanRef.current) return;
    bootstrapRanRef.current = true;

    const controller = new AbortController();

    const load = async () => {
      setLoading(true);
      setError(null);
      try {
        const url = withBackendOrigin(`/api/browse/playlist?browseId=${encodeURIComponent(albumId)}`);
        const res = await fetch(url, {
          method: "GET",
          headers: { Accept: "application/json", ...(await getBackendHeaders()) },
          credentials: "include",
          signal: controller.signal,
        });

        const json = (await res.json().catch(() => ({}))) as Partial<AlbumApiResponse> & { error?: string };
        if (!res.ok) throw new Error(typeof json.error === "string" ? json.error : "Album fetch failed");

        setMeta((prev) => ({
          title: normalize(json.title) || prev.title || albumId,
          subtitle: normalize(json.subtitle) || prev.subtitle,
          thumbnail: normalize(json.thumbnail) || prev.thumbnail || null,
        }));

        const nextTracks = Array.isArray(json.tracks) ? json.tracks : [];
        setTracks(nextTracks);
      } catch (err: any) {
        if (err?.name === "AbortError") return;
        setError(err?.message || "Album fetch failed");
        setTracks([]);
      } finally {
        setLoading(false);
      }
    };

    void load();
    return () => controller.abort();
  }, [albumId]);

  const normalizedTracks = useMemo(() => {
    return tracks
      .map((t) => {
        if (!isVideoId(t.videoId)) return null;
        return {
          videoId: t.videoId.trim(),
          title: normalize(t.title) || "Untitled",
          artist: normalize(t.artist),
          duration: normalize(t.duration),
          thumbnailUrl: t.thumbnail ?? null,
        };
      })
      .filter(Boolean) as Array<{ videoId: string; title: string; artist: string; duration: string; thumbnailUrl: string | null }>;
  }, [tracks]);

  const playbackQueue = useMemo(
    () =>
      normalizedTracks.map((t) => ({
        youtubeVideoId: t.videoId,
        title: t.title,
        artist: t.artist,
        thumbnailUrl: t.thumbnailUrl ?? undefined,
      })),
    [normalizedTracks],
  );

  const handlePlayAll = () => {
    if (!playbackQueue.length) return;
    playCollection(playbackQueue, 0, "album", albumId || null);
  };

  const handleShufflePlay = () => {
    if (!playbackQueue.length) return;
    const randomIndex = Math.floor(Math.random() * playbackQueue.length);
    playCollection(playbackQueue, randomIndex, "album", albumId || null);
  };

  const handlePlayTrack = (index: number) => {
    if (!playbackQueue.length) return;
    playCollection(playbackQueue, index, "album", albumId || null);
  };

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
            ←
          </button>
          <div className="min-w-0 truncate text-base font-semibold text-white md:text-lg">{meta.title || albumId}</div>
        </div>

        <PlaylistHeader
          // PlaylistHeader also serves album layouts for consistency
          title={meta.title || albumId}
          thumbnail={meta.thumbnail}
          trackCount={normalizedTracks.length}
          onPlayAll={handlePlayAll}
          onShuffle={handleShufflePlay}
          disablePlayback={!playbackQueue.length}
          subtitle={meta.subtitle}
        />

        {error ? (
          <div className="mt-6 rounded-xl border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-100">{error}</div>
        ) : null}

        <div className="mt-8 rounded-2xl border border-white/10 bg-black/60 shadow-2xl">
          {loading ? (
            <div className="px-6 py-10 text-center text-sm text-neutral-400">Loading tracks...</div>
          ) : normalizedTracks.length === 0 ? (
            <div className="px-6 py-10 text-center text-sm text-neutral-400">No tracks available for this album.</div>
          ) : (
            <div className="divide-y divide-white/5">
              {normalizedTracks.map((track, index) => (
                <TrackRow
                  key={track.videoId}
                  index={index}
                  title={track.title}
                  artist={track.artist}
                  duration={track.duration}
                  thumbnailUrl={track.thumbnailUrl ?? undefined}
                  onSelect={() => handlePlayTrack(index)}
                />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
