import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { ArrowLeft, Music, Play } from "lucide-react";

import TrackCard from "@/components/TrackCard";
import ErrorState from "@/components/ui/ErrorState";
import { Button } from "@/components/ui/button";
import { usePlayer } from "@/contexts/PlayerContext";
import {
  searchResolve,
  type SearchArtistItem,
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

const isArtistItem = (item: any): item is SearchArtistItem =>
  item && typeof item.name === "string" && typeof item.id === "string";

const isTrackItem = (item: any): item is SearchTrackItem => {
  const hasId = typeof item?.youtubeVideoId === "string" || typeof item?.youtubeId === "string";
  return hasId && typeof item?.title === "string";
};

const pickYoutubeId = (item: SearchTrackItem): string | null => {
  if (typeof item.youtubeVideoId === "string" && item.youtubeVideoId.trim()) return item.youtubeVideoId.trim();
  if (typeof item.youtubeId === "string" && item.youtubeId.trim()) return item.youtubeId.trim();
  return null;
};

export default function Artist() {
  const navigate = useNavigate();
  const { artistKey } = useParams();
  const { playCollection, youtubeVideoId } = usePlayer();

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [sections, setSections] = useState<SearchSection[]>([]);

  const loadArtist = async (key: string) => {
    try {
      setLoading(true);
      setError(null);
      const response = await searchResolve({ q: key });
      setSections(response.sections ?? []);
    } catch (err: any) {
      setError(err?.message || "Unable to load artist data.");
      setSections([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!artistKey) return;
    void loadArtist(artistKey);
  }, [artistKey]);

  const flatItems = useMemo(() => sections.flatMap((section) => section.items ?? []), [sections]);

  const artistData = useMemo(() => {
    const match = flatItems.find((item) => isArtistItem(item) && item.id === artistKey);
    if (match) return match;
    return flatItems.find(isArtistItem) ?? null;
  }, [flatItems, artistKey]);

  const artistName = artistData?.name || artistKey || "Artist";
  const artistSubtitle = artistData?.subtitle;
  const artistImage = artistData?.imageUrl;

  const tracks: NormalizedTrack[] = useMemo(() => {
    const items = flatItems.filter(isTrackItem);
    return items
      .map((item) => {
        const youtubeId = pickYoutubeId(item);
        if (!youtubeId) return null;
        const artistLabel =
          (Array.isArray(item.artists) && item.artists.filter(Boolean).join(", ")) ||
          item.artist ||
          artistName;

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
  }, [flatItems, artistName]);

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

  const handlePlayAll = () => {
    if (!playbackQueue.length) return;
    playCollection(playbackQueue, 0, "artist", null);
  };

  const handlePlayTrack = (index: number) => {
    playCollection(playbackQueue, index, "artist", null);
  };

  if (loading) {
    return <div className="p-6 text-sm text-neutral-400">Loading artist...</div>;
  }

  if (error) {
    return (
      <div className="p-6">
        <ErrorState title="Artist request failed" subtitle={error} onRetry={() => artistKey && loadArtist(artistKey)} />
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

        <div className="flex flex-col items-center gap-3 pt-4 text-center">
          <div className="h-28 w-28 overflow-hidden rounded-full border border-white/10 bg-neutral-900">
            {artistImage ? (
              <img src={artistImage} alt={artistName} className="h-full w-full object-cover" />
            ) : (
              <div className="flex h-full items-center justify-center text-3xl font-semibold text-neutral-300">
                {artistName.slice(0, 1).toUpperCase()}
              </div>
            )}
          </div>

          <div className="space-y-1">
            <h1 className="text-3xl font-black leading-tight">{artistName}</h1>
            {artistSubtitle ? <p className="text-sm text-neutral-400">{artistSubtitle}</p> : null}
          </div>

          <button className="pm-cta-pill" onClick={handlePlayAll} disabled={!playbackQueue.length}>
            <span className="pm-cta-pill-inner">
              <Play className="h-5 w-5" />
              Play all
            </span>
          </button>
        </div>

        <section className="mt-10 space-y-4">
          <div className="flex items-center gap-2 text-neutral-200">
            <Music className="h-5 w-5" />
            <h2 className="text-xl font-semibold">Tracks</h2>
          </div>

          {tracks.length === 0 ? (
            <div className="rounded-lg border border-white/5 bg-white/5 p-4 text-sm text-neutral-400">
              No tracks available.
            </div>
          ) : (
            <div className="space-y-2">
              {tracks.map((track, index) => (
                <TrackCard
                  key={track.id}
                  id={track.id}
                  title={track.title}
                  artist={track.artist}
                  imageUrl={track.imageUrl}
                  youtubeVideoId={track.youtubeVideoId}
                  duration={track.durationSeconds}
                  isActive={youtubeVideoId === track.youtubeVideoId}
                  onPlay={() => handlePlayTrack(index)}
                  playbackContext="artist"
                />
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
