import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { ArrowLeft, ListMusic, Play } from "lucide-react";

import ErrorState from "@/components/ui/ErrorState";
import { Button } from "@/components/ui/button";
import { usePlayer } from "@/contexts/PlayerContext";
import {
  searchResolve,
  type SearchPlaylistItem,
  type SearchSection,
  type SearchTrackItem,
} from "@/lib/api/search";

type NormalizedTrack = {
  id: string;
  title: string;
  artist: string;
  imageUrl?: string;
  youtubeVideoId: string;
  durationSeconds?: number;
};

const isPlaylistItem = (item: any): item is SearchPlaylistItem =>
  item && typeof item.id === "string" && typeof item.title === "string";

const isTrackItem = (item: any): item is SearchTrackItem => {
  const hasYoutube = typeof item?.youtubeVideoId === "string" || typeof item?.youtubeId === "string";
  return hasYoutube && typeof item?.title === "string";
};

const pickYoutubeId = (item: SearchTrackItem): string | null => {
  if (typeof item.youtubeVideoId === "string" && item.youtubeVideoId.trim()) return item.youtubeVideoId.trim();
  if (typeof item.youtubeId === "string" && item.youtubeId.trim()) return item.youtubeId.trim();
  return null;
};

export default function Playlist() {
  const { id: playlistId } = useParams();
  const navigate = useNavigate();
  const { playCollection, youtubeVideoId } = usePlayer();

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [sections, setSections] = useState<SearchSection[]>([]);

  const loadPlaylist = async (key: string) => {
    try {
      setLoading(true);
      setError(null);
      const response = await searchResolve({ q: key });
      setSections(response.sections ?? []);
    } catch (err: any) {
      setError(err?.message || "Unable to load playlist.");
      setSections([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!playlistId) return;
    void loadPlaylist(playlistId);
  }, [playlistId]);

  const flatItems = useMemo(() => sections.flatMap((section) => section.items ?? []), [sections]);

  const playlistMeta = useMemo(() => {
    const match = flatItems.find((item) => isPlaylistItem(item) && item.id === playlistId);
    if (match) return match;
    return flatItems.find(isPlaylistItem) ?? null;
  }, [flatItems, playlistId]);

  const tracks: NormalizedTrack[] = useMemo(() => {
    const items = flatItems.filter(isTrackItem);
    return items
      .map((item) => {
        const youtubeId = pickYoutubeId(item);
        if (!youtubeId) return null;
        const artistLabel =
          (Array.isArray(item.artists) && item.artists.filter(Boolean).join(", ")) ||
          item.artist ||
          (playlistMeta?.subtitle ?? "Artist");
        return {
          id: item.id || youtubeId,
          title: item.title,
          artist: artistLabel,
          imageUrl: item.imageUrl,
          youtubeVideoId: youtubeId,
          durationSeconds: typeof item.durationMs === "number" ? Math.round(item.durationMs / 1000) : undefined,
        } satisfies NormalizedTrack;
      })
      .filter(Boolean) as NormalizedTrack[];
  }, [flatItems, playlistMeta?.subtitle]);

  const playbackQueue = useMemo(
    () =>
      tracks.map((track) => ({
        youtubeVideoId: track.youtubeVideoId,
        title: track.title,
        artist: track.artist,
        thumbnailUrl: track.imageUrl,
      })),
    [tracks],
  );

  const heading = playlistMeta?.title || playlistId || "Playlist";
  const subtitle = playlistMeta?.subtitle || null;

  const handlePlayAll = () => {
    if (!playbackQueue.length) return;
    playCollection(playbackQueue, 0, "playlist", playlistMeta?.id ?? null);
  };

  const handlePlayTrack = (index: number) => {
    playCollection(playbackQueue, index, "playlist", playlistMeta?.id ?? null);
  };

  if (loading) {
    return <div className="p-6 text-sm text-neutral-400">Loading playlist...</div>;
  }

  if (error) {
    return (
      <div className="p-6">
        <ErrorState title="Playlist request failed" subtitle={error} onRetry={() => playlistId && loadPlaylist(playlistId)} />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-neutral-950 pb-28 text-white">
      <div className="relative mx-auto max-w-5xl px-4 pt-6">
        <div className="absolute left-0 top-0">
          <Button variant="ghost" size="icon" onClick={() => navigate(-1)}>
            <ArrowLeft className="h-5 w-5" />
          </Button>
        </div>

        <div className="flex flex-col gap-6 md:flex-row md:items-end md:gap-8">
          <div className="h-44 w-full overflow-hidden rounded-xl border border-white/10 bg-neutral-900 md:h-48 md:w-48">
            {playlistMeta?.imageUrl ? (
              <img src={playlistMeta.imageUrl} alt={heading} className="h-full w-full object-cover" />
            ) : (
              <div className="flex h-full items-center justify-center text-3xl font-bold text-[#F6C66D]">
                {heading.slice(0, 1) || "?"}
              </div>
            )}
          </div>

          <div className="flex flex-1 flex-col gap-2 pb-2">
            <p className="text-xs uppercase tracking-[0.25em] text-white/60">Playlist</p>
            <h1 className="text-3xl font-black leading-tight text-white">{heading}</h1>
            {subtitle ? <p className="text-sm text-white/70">{subtitle}</p> : null}

            <div className="flex flex-wrap items-center gap-3 pt-2">
              <button className="pm-cta-pill" onClick={handlePlayAll} disabled={!playbackQueue.length}>
                <span className="pm-cta-pill-inner">
                  <Play className="h-5 w-5" />
                  Play all
                </span>
              </button>

              <div className="flex items-center gap-2 text-sm text-white/70">
                <ListMusic className="h-4 w-4" />
                <span>{tracks.length} tracks</span>
              </div>
            </div>
          </div>
        </div>

        <div className="mt-10 space-y-2">
          {tracks.length === 0 ? (
            <div className="rounded-lg border border-white/5 bg-white/5 p-4 text-sm text-neutral-400">
              No tracks available.
            </div>
          ) : (
            tracks.map((track, index) => (
              <div
                key={track.id}
                className={`flex items-center gap-3 rounded-lg border px-3 py-3 ${
                  youtubeVideoId === track.youtubeVideoId
                    ? "border-[#FF4FB7]/60 bg-[#FF4FB7]/10"
                    : "border-white/5 bg-white/5 hover:bg-white/10"
                }`}
              >
                <div className="w-6 shrink-0 text-center text-xs text-neutral-400">{index + 1}</div>
                <div className="h-12 w-12 overflow-hidden rounded-md bg-neutral-800">
                  {track.imageUrl ? (
                    <img src={track.imageUrl} alt={track.title} className="h-full w-full object-cover" />
                  ) : null}
                </div>

                <div className="flex min-w-0 flex-1 flex-col">
                  <span className="truncate font-semibold text-neutral-50">{track.title}</span>
                  <span className="truncate text-sm text-neutral-400">{track.artist}</span>
                </div>

                <div className="flex items-center gap-2">
                  {track.durationSeconds ? (
                    <span className="text-xs text-neutral-400 tabular-nums">
                      {Math.floor(track.durationSeconds / 60)}:{(track.durationSeconds % 60).toString().padStart(2, "0")}
                    </span>
                  ) : null}

                  <button
                    type="button"
                    className="pm-cta-pill"
                    onClick={() => handlePlayTrack(index)}
                    aria-label={`Play ${track.title}`}
                  >
                    <span className="pm-cta-pill-inner">
                      <Play className="h-4 w-4" />
                    </span>
                  </button>
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
