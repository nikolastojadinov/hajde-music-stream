import { useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";

import { PlaylistHeader } from "@/components/PlaylistHeader";
import { TrackRow } from "@/components/TrackRow";
import { usePlayer } from "@/contexts/PlayerContext";
import { withBackendOrigin } from "@/lib/backendUrl";
import { getBackendHeaders } from "@/contexts/PiContext";

type ApiTrack = {
  videoId: string;
  title: string;
  artist: string | null;
  duration: string;
  thumbnail: string | null;
};

type PlaylistApiResponse = {
  id: string;
  title: string;
  thumbnail: string | null;
  tracks: ApiTrack[];
};

type LocationState = {
  playlistId?: string;
  playlistTitle?: string;
  playlistCover?: string | null;
  artistName?: string;
};

const isVideoId = (value: string | undefined | null): value is string => typeof value === "string" && /^[A-Za-z0-9_-]{11}$/.test(value.trim());

export default function PlaylistPage() {
  const { id } = useParams();
  const browseId = (id || "").trim();
  const navigate = useNavigate();
  const location = useLocation();
  const { playCollection } = usePlayer();

  const state = (location.state || {}) as LocationState;
  const navTitle = typeof state.playlistTitle === "string" ? state.playlistTitle.trim() : "";
  const navCover = state.playlistCover ?? null;
  const navArtist = typeof state.artistName === "string" ? state.artistName.trim() : "";

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tracks, setTracks] = useState<ApiTrack[]>([]);

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
          headers: { Accept: "application/json", ...getBackendHeaders() },
          credentials: "include",
          signal: controller.signal,
        });
        const json = (await res.json().catch(() => ({}))) as Partial<PlaylistApiResponse>;
        if (!res.ok) throw new Error(typeof (json as any)?.error === "string" ? (json as any).error : "Playlist fetch failed");
        setTracks(Array.isArray(json.tracks) ? json.tracks : []);
      } catch (err: any) {
        if (err?.name === "AbortError") return;
        setError(err?.message || "Playlist fetch failed");
        setTracks([]);
      } finally {
        setLoading(false);
      }
    };

    void load();
    return () => controller.abort();
  }, [browseId]);

  const normalizedTracks = useMemo(() => {
    return tracks
      .map((t) => {
        if (!isVideoId(t.videoId)) return null;
        return {
          videoId: t.videoId.trim(),
          title: (t.title || "").trim(),
          artist: navArtist,
          duration: (t.duration || "").trim(),
          thumbnailUrl: t.thumbnail ?? null,
        };
      })
      .filter(Boolean) as Array<{ videoId: string; title: string; artist: string; duration: string; thumbnailUrl: string | null }>;
  }, [tracks, navArtist]);

  const playbackQueue = useMemo(
    () => normalizedTracks.map((t) => ({ youtubeVideoId: t.videoId, title: t.title, artist: t.artist, thumbnailUrl: t.thumbnailUrl ?? undefined })),
    [normalizedTracks],
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

  const hasNavContext = Boolean(navTitle);

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
          <div className="truncate text-base font-semibold text-white md:text-lg">{navTitle}</div>
        </div>

        {hasNavContext ? (
          <PlaylistHeader
            title={navTitle}
            thumbnail={navCover}
            trackCount={normalizedTracks.length}
            onPlayAll={handlePlayAll}
            onShuffle={handleShufflePlay}
            disablePlayback={!playbackQueue.length}
          />
        ) : (
          <div className="rounded-2xl border border-white/10 bg-neutral-900/60 px-6 py-6 text-sm text-neutral-300">
            Playlist context missing.
          </div>
        )}

        {error ? (
          <div className="mt-6 rounded-xl border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-100">{error}</div>
        ) : null}

        <div className="mt-8 rounded-2xl border border-white/10 bg-black/60 shadow-2xl">
          {loading ? (
            <div className="px-6 py-10 text-center text-sm text-neutral-400">Loading tracks...</div>
          ) : normalizedTracks.length === 0 ? (
            <div className="px-6 py-10 text-center text-sm text-neutral-400">No tracks available for this playlist.</div>
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
