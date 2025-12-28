import { useEffect, useMemo, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { ListMusic, Music, Play, ArrowLeft } from "lucide-react";

import { Button } from "@/components/ui/button";
import EmptyState from "@/components/ui/EmptyState";
import ErrorState from "@/components/ui/ErrorState";
import PlaylistCard from "@/components/PlaylistCard";
import TrackCard from "@/components/TrackCard";
import { ScrollArea, ScrollBar } from "@/components/ui/scroll-area";
import { usePlayer } from "@/contexts/PlayerContext";
import { fetchArtistByKey } from "@/lib/api/artist";

/* -------------------------------------------------------------------------- */
/* types                                                                      */
/* -------------------------------------------------------------------------- */

type ApiPlaylist = {
  id: string;
  title: string;
  youtube_playlist_id: string;
  cover_url?: string | null;
};

type ApiTrack = {
  id: string;
  title: string;
  youtube_video_id: string;
  cover_url?: string | null;
  duration?: number | null;
};

type ArtistOkResponse = {
  status: "ok";
  artist: {
    artist_name: string;
    thumbnail_url: string | null;
    banner_url: string | null;
  };
  playlists: ApiPlaylist[];
  tracks: ApiTrack[];
};

type ArtistNotReadyResponse = { status: "not_ready" };
type ArtistErrorResponse = { error: string };

/* -------------------------------------------------------------------------- */
/* utils                                                                      */
/* -------------------------------------------------------------------------- */

function normalizeString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function formatCount(n: number): string {
  return new Intl.NumberFormat().format(n);
}

function isDisplayablePlaylist(p: ApiPlaylist): boolean {
  const title = normalizeString(p.title).toLowerCase();
  if (!title) return false;
  if (title === "untitled") return false;
  if (title === "untitled playlist") return false;
  return true;
}

function cleanTrackTitle(rawTitle: string, artist: string): string {
  const title = normalizeString(rawTitle) || "Unknown title";
  const a = normalizeString(artist);
  if (!a) return title;
  const re = new RegExp(`^${a}\\s*-\\s*`, "i");
  return title.replace(re, "").trim() || title;
}

/* -------------------------------------------------------------------------- */
/* component                                                                  */
/* -------------------------------------------------------------------------- */

export default function Artist() {
  const { artistKey } = useParams();
  const navigate = useNavigate();
  const { playPlaylist } = usePlayer();

  const key = normalizeString(artistKey);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<"ok" | "not_ready" | "unknown">("unknown");

  const [playlists, setPlaylists] = useState<ApiPlaylist[]>([]);
  const [tracks, setTracks] = useState<ApiTrack[]>([]);
  const [artistName, setArtistName] = useState(key);
  const [media, setMedia] = useState<{ thumbnail_url: string | null } | null>(null);

  const displayPlaylists = useMemo(
    () => playlists.filter(isDisplayablePlaylist),
    [playlists]
  );

  const playlistTracks = useMemo(
    () =>
      tracks
        .filter(t => t.youtube_video_id)
        .map(t => ({
          id: t.id,
          external_id: t.youtube_video_id,
          title: cleanTrackTitle(t.title, artistName),
          artist: artistName,
        })),
    [tracks, artistName]
  );

  useEffect(() => {
    let active = true;

    async function load() {
      try {
        setLoading(true);
        const res = await fetchArtistByKey(key);
        if (!active) return;

        if (res?.status === "not_ready") {
          setStatus("not_ready");
          return;
        }

        if (res?.status === "ok") {
          setStatus("ok");
          setArtistName(normalizeString(res.artist.artist_name) || key);
          setMedia({ thumbnail_url: res.artist.thumbnail_url });
          setPlaylists(Array.isArray(res.playlists) ? res.playlists : []);
          setTracks(Array.isArray(res.tracks) ? res.tracks : []);
          return;
        }

        setError("Artist request failed");
      } catch (e: any) {
        if (active) setError(e?.message ?? "Artist request failed");
      } finally {
        if (active) setLoading(false);
      }
    }

    if (key) load();
    else {
      setLoading(false);
      setError("Missing artist");
    }

    return () => {
      active = false;
    };
  }, [key]);

  if (loading) {
    return <div className="p-4 text-center text-muted-foreground">Učitavanje…</div>;
  }

  if (error) {
    return <ErrorState title="Artist error" subtitle={error} />;
  }

  if (status === "not_ready") {
    return <EmptyState title="Artist not ready" subtitle="Please retry later." />;
  }

  return (
    <div className="pb-32">
      <div className="px-4 pt-6 text-center">
        <h1 className="text-2xl font-black">{artistName}</h1>
        <p className="text-sm text-muted-foreground mt-1">
          {formatCount(tracks.length)} tracks • {formatCount(displayPlaylists.length)} playlists
        </p>

        <Button
          size="lg"
          className="rounded-full mt-4"
          onClick={() => playPlaylist(playlistTracks, 0)}
          disabled={playlistTracks.length === 0}
        >
          <Play className="w-5 h-5 mr-2" />
          Play
        </Button>
      </div>

      {/* PLAYLISTS */}
      <section className="mt-8 px-4">
        <h2 className="text-xl font-bold mb-4 flex items-center gap-2">
          <ListMusic className="w-5 h-5" /> Playlists
        </h2>

        {displayPlaylists.length === 0 ? (
          <EmptyState title="No playlists" subtitle="Nothing to show" />
        ) : (
          <ScrollArea className="w-full whitespace-nowrap">
            <div className="flex gap-3 md:gap-4 pb-4">
              {displayPlaylists.map(p => (
                <div
                  key={p.id}
                  className="w-[130px] md:w-[140px] flex-shrink-0"
                >
                  <PlaylistCard
                    id={p.id}
                    title={p.title}
                    imageUrl={p.cover_url || "/placeholder.svg"}
                  />
                </div>
              ))}
            </div>
            <ScrollBar orientation="horizontal" />
          </ScrollArea>
        )}
      </section>

      {/* TRACKS */}
      <section className="mt-8 px-4">
        <h2 className="text-xl font-bold mb-4 flex items-center gap-2">
          <Music className="w-5 h-5" /> Tracks
        </h2>

        {tracks.length === 0 ? (
          <EmptyState title="No tracks" subtitle="Nothing to show" />
        ) : (
          tracks.map(t => (
            <TrackCard
              key={t.id}
              id={t.id}
              title={cleanTrackTitle(t.title, artistName)}
              artist={artistName}
              youtubeId={t.youtube_video_id}
              imageUrl={t.cover_url}
              duration={t.duration ?? null}
            />
          ))
        )}
      </section>
    </div>
  );
}
