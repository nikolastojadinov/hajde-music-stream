import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { ArrowLeft, ListMusic, Play, ExternalLink } from "lucide-react";

import { usePlayer } from "@/contexts/PlayerContext";
import { fetchPlaylistById, type PlaylistResponse } from "@/lib/api/playlist";
import TrackCard from "@/components/TrackCard";
import ErrorState from "@/components/ui/ErrorState";
import { Button } from "@/components/ui/button";

function normalizeString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

export default function Playlist() {
  const { id: playlistIdParam } = useParams();
  const navigate = useNavigate();
  const { playCollection, youtubeVideoId } = usePlayer();

  const playlistId = normalizeString(playlistIdParam);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [playlist, setPlaylist] = useState<PlaylistResponse | null>(null);

  useEffect(() => {
    let active = true;

    async function load() {
      try {
        setLoading(true);
        setError(null);
        const json = await fetchPlaylistById(playlistId, { max: 100 });
        if (!active) return;
        setPlaylist(json);
      } catch (err: any) {
        if (active) setError(err?.message || "Playlist request failed");
      } finally {
        if (active) setLoading(false);
      }
    }

    if (playlistId) load();
    return () => {
      active = false;
    };
  }, [playlistId]);

  const tracks = useMemo(() => {
    if (!playlist?.videoIds) return [];
    const author = playlist.author || "YouTube Music";
    return playlist.videoIds.map((videoId, index) => ({
      youtubeVideoId: videoId,
      title: `${playlist.title || "Playlist"} #${index + 1}`,
      artist: author,
      thumbnailUrl: playlist.thumbnailUrl || undefined,
    }));
  }, [playlist]);

  const handlePlayAll = () => {
    if (!tracks.length) return;
    playCollection(tracks, 0, "playlist", playlist?.id ?? null);
  };

  const handleOpenOnYouTube = () => {
    if (!playlistId) return;
    window.open(`https://music.youtube.com/playlist?list=${encodeURIComponent(playlistId)}`, "_blank");
  };

  const heading = playlist?.title || playlistId || "Playlist";

  if (loading) {
    return <div className="p-6 text-sm text-neutral-400">Loading playlist...</div>;
  }

  if (error) {
    return (
      <div className="p-6">
        <ErrorState title="Playlist request failed" subtitle={error} onRetry={() => window.location.reload()} />
      </div>
    );
  }

  return (
    <div className="pb-28 text-white">
      <div className="relative">
        <div className="absolute left-3 top-3 z-10">
          <Button variant="ghost" size="icon" onClick={() => navigate(-1)}>
            <ArrowLeft className="h-5 w-5" />
          </Button>
        </div>

        <div className="h-64 w-full bg-gradient-to-br from-[#120f1f] via-[#1b1831] to-[#0d0b16]">
          <div className="mx-auto flex h-full max-w-5xl items-end gap-6 px-6 pb-6">
            <div className="h-40 w-40 overflow-hidden rounded-xl border border-white/10 bg-neutral-900">
              {playlist?.thumbnailUrl ? (
                <img src={playlist.thumbnailUrl} alt={heading} className="h-full w-full object-cover" />
              ) : (
                <div className="flex h-full items-center justify-center text-3xl font-bold text-[#F6C66D]">
                  {heading[0] ?? "?"}
                </div>
              )}
            </div>

            <div className="flex flex-1 flex-col gap-2 pb-2">
              <p className="text-xs uppercase tracking-[0.25em] text-white/60">YouTube Playlist</p>
              <h1 className="text-3xl font-black leading-tight text-white">{heading}</h1>
              {playlist?.author && <p className="text-sm text-white/70">{playlist.author}</p>}

              <div className="flex flex-wrap gap-3 pt-2">
                <button className="pm-cta-pill" onClick={handlePlayAll} disabled={!tracks.length}>
                  <span className="pm-cta-pill-inner">
                    <Play className="h-5 w-5" />
                    Play all
                  </span>
                </button>

                <button
                  className="pm-cta-secondary"
                  onClick={handleOpenOnYouTube}
                  aria-label="Open on YouTube Music"
                >
                  <span className="pm-cta-pill-inner text-sm">
                    <ExternalLink className="h-4 w-4" />
                    Open on YouTube Music
                  </span>
                </button>

                <div className="flex items-center gap-2 text-sm text-white/70">
                  <ListMusic className="h-4 w-4" />
                  <span>{tracks.length} tracks</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="mx-auto max-w-5xl px-6 py-6 space-y-3">
        {tracks.length === 0 ? (
          <div className="rounded-lg border border-white/5 bg-white/5 p-4 text-sm text-white/70">
            No tracks were found for this playlist.
          </div>
        ) : (
          tracks.map((track, index) => (
            <TrackCard
              key={track.youtubeVideoId}
              title={track.title}
              artist={track.artist}
              imageUrl={track.thumbnailUrl}
              youtubeVideoId={track.youtubeVideoId}
              isActive={youtubeVideoId === track.youtubeVideoId}
              onPlay={() => playCollection(tracks, index, "playlist", playlist?.id ?? null)}
              playbackContext="playlist"
            />
          ))
        )}
      </div>
    </div>
  );
}
