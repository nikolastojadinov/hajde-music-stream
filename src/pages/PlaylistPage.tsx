import { useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";

import { PlaylistHeader } from "@/components/PlaylistHeader";
import { TrackRow } from "@/components/TrackRow";
import { usePlayer } from "@/contexts/PlayerContext";
import { withBackendOrigin } from "@/lib/backendUrl";

type PlaylistTrack = {
  videoId: string;
  title: string;
  artist: string | null;
  duration: string;
  thumbnail: string | null;
};

type PlaylistResponse = {
  id: string;
  title: string;
  thumbnail: string | null;
  tracks: PlaylistTrack[];
};

type LocationState = {
  title?: string;
  artist?: string;
};

const looksLikePlaylistId = (value: string | undefined | null, browseId?: string): boolean => {
  if (typeof value !== "string") return false;
  const trimmed = value.trim();
  if (!trimmed) return false;
  if (browseId && trimmed === browseId) return true;
  return /^(MPRE|OLAK|VL|RDCLAK|PL)[A-Za-z0-9_-]+$/.test(trimmed);
};

const isVideoId = (value: string | undefined | null): value is string => typeof value === "string" && /^[A-Za-z0-9_-]{11}$/.test(value.trim());

export default function PlaylistPage() {
  const { id } = useParams();
  const browseId = (id || "").trim();
  const navigate = useNavigate();
  const location = useLocation();
  const { playCollection } = usePlayer();

  const state = (location.state || {}) as LocationState;
  const stateTitle = typeof state.title === "string" ? state.title.trim() : "";
  const stateArtist = typeof state.artist === "string" ? state.artist.trim() : "";

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [playlist, setPlaylist] = useState<PlaylistResponse | null>(null);

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
        const json = await res.json().catch(() => ({} as PlaylistResponse));
        if (!res.ok) throw new Error(typeof (json as any)?.error === "string" ? (json as any).error : "Playlist fetch failed");
        setPlaylist(json as PlaylistResponse);
      } catch (err: any) {
        if (err?.name === "AbortError") return;
        setError(err?.message || "Playlist fetch failed");
        setPlaylist(null);
      } finally {
        setLoading(false);
      }
    };

    void load();
    return () => controller.abort();
  }, [browseId]);

  const playlistTitleRaw = (playlist?.title || "").trim();
  const title =
    looksLikePlaylistId(playlistTitleRaw, browseId) && stateTitle
      ? stateTitle
      : playlistTitleRaw && !looksLikePlaylistId(playlistTitleRaw, browseId)
        ? playlistTitleRaw
        : stateTitle;

  const playlistArtist = stateArtist || "";

  const tracks = useMemo(() => {
    if (!Array.isArray(playlist?.tracks)) return [];
    return playlist.tracks
      .map((t) => {
        if (!isVideoId(t.videoId)) return null;
        return {
          videoId: t.videoId.trim(),
          title: (t.title || "").trim(),
          artist: playlistArtist || (t.artist || "").trim(),
          duration: (t.duration || "").trim(),
        };
      })
      .filter(Boolean) as Array<{ videoId: string; title: string; artist: string; duration: string }>;
  }, [playlist?.tracks, playlistArtist]);

  const playbackQueue = useMemo(
    () => tracks.map((t) => ({ youtubeVideoId: t.videoId, title: t.title, artist: t.artist, thumbnailUrl: undefined })),
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

  if (loading) {
    return (
      <div className="min-h-screen bg-gradient-to-b from-neutral-950 via-neutral-950 to-black text-white">
        <div className="mx-auto max-w-6xl px-4 py-12 text-sm text-neutral-400">Loading playlist...</div>
      </div>
    );
  }

  if (!playlist || !title) {
    return (
      <div className="min-h-screen bg-gradient-to-b from-neutral-950 via-neutral-950 to-black text-white">
        <div className="mx-auto max-w-6xl px-4 py-12 text-sm text-neutral-400">{error || "Playlist unavailable."}</div>
        <div className="mx-auto max-w-6xl px-4">
          <button
            type="button"
            onClick={() => navigate(-1)}
            className="mt-4 rounded border border-white/20 px-3 py-2 text-sm text-white hover:bg-white/10"
          >
            Go back
          </button>
        </div>
      </div>
    );
  }

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
          <div className="truncate text-base font-semibold text-white md:text-lg">{title}</div>
        </div>

        <PlaylistHeader
          title={title}
          thumbnail={playlist.thumbnail}
          trackCount={tracks.length}
          onPlayAll={handlePlayAll}
          onShuffle={handleShufflePlay}
          disablePlayback={!playbackQueue.length}
        />

        {error ? (
          <div className="mt-6 rounded-xl border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-100">{error}</div>
        ) : null}

        <div className="mt-8 rounded-2xl border border-white/10 bg-black/60 shadow-2xl">
          {tracks.length === 0 ? (
            <div className="px-6 py-10 text-center text-sm text-neutral-400">No tracks available for this playlist.</div>
          ) : (
            <div className="divide-y divide-white/5">
              {tracks.map((track, index) => (
                <TrackRow
                  key={track.videoId}
                  index={index}
                  title={track.title}
                  artist={track.artist || undefined}
                  duration={track.duration}
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
