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

/* ===================== TYPES ===================== */

type ApiPlaylist = {
  id: string;
  title: string;
  youtube_playlist_id: string;
  cover_url?: string | null;
  youtube_channel_id?: string;
  source?: string;
  created_at?: string | null;
};

type ApiTrack = {
  id: string;
  title: string;
  youtube_video_id: string;
  cover_url?: string | null;
  duration?: number | null;
  youtube_channel_id?: string;
  artist_name?: string | null;
  created_at?: string | null;
};

type ArtistOkResponse = {
  status: "ok";
  artist: {
    artist_name: string;
    youtube_channel_id: string | null;
    thumbnail_url: string | null;
    banner_url: string | null;
  };
  playlists: ApiPlaylist[];
  tracks: ApiTrack[];
};

type ArtistNotReadyResponse = { status: "not_ready" };
type ArtistErrorResponse = { error: string };

/* ===================== UTILS ===================== */

function normalizeString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function formatCount(n: number): string {
  return new Intl.NumberFormat().format(n);
}

function isOk(x: any): x is ArtistOkResponse {
  return x && x.status === "ok" && Array.isArray(x.playlists) && Array.isArray(x.tracks);
}

function isNotReady(x: any): x is ArtistNotReadyResponse {
  return x && x.status === "not_ready";
}

function isError(x: any): x is ArtistErrorResponse {
  return x && typeof x.error === "string";
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function cleanTrackTitle(rawTitle: string, canonicalArtistName: string): string {
  const title = normalizeString(rawTitle) || "Unknown title";
  const artist = normalizeString(canonicalArtistName);
  if (!artist) return title;
  const pattern = new RegExp(`^${escapeRegex(artist)}\\s*-\\s*`, "i");
  return title.replace(pattern, "").trim() || title;
}

function isDisplayablePlaylist(p: ApiPlaylist): boolean {
  const title = normalizeString(p?.title);
  if (!title) return false;
  if (title.toLowerCase().includes("untitled")) return false;
  return Boolean(normalizeString(p?.cover_url));
}

/* ===================== COMPONENT ===================== */

export default function Artist() {
  const { artistKey: artistKeyParam } = useParams();
  const navigate = useNavigate();

  // ⬇️ BITNO: uzimamo GLOBALNI player state
  const { playPlaylist, currentTrackId } = usePlayer();

  const artistKey = normalizeString(artistKeyParam);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<"ok" | "not_ready" | "unknown">("unknown");
  const [reloadNonce, setReloadNonce] = useState(0);

  const [playlists, setPlaylists] = useState<ApiPlaylist[]>([]);
  const [tracks, setTracks] = useState<ApiTrack[]>([]);
  const [artistMedia, setArtistMedia] = useState<{ thumbnail_url: string | null; banner_url: string | null } | null>(null);
  const [artistTitle, setArtistTitle] = useState<string>(artistKey);

  const canonicalArtistName = useMemo(
    () => normalizeString(artistTitle) || normalizeString(artistKey) || "Artist",
    [artistTitle, artistKey]
  );

  const playlistTracks = useMemo(
    () =>
      tracks
        .filter((t) => t.youtube_video_id)
        .map((t) => ({
          id: t.id,
          external_id: t.youtube_video_id,
          title: cleanTrackTitle(t.title, canonicalArtistName),
          artist: canonicalArtistName,
        })),
    [tracks, canonicalArtistName]
  );

  const displayPlaylists = useMemo(
    () => playlists.filter(isDisplayablePlaylist),
    [playlists]
  );

  /* ===================== PLAY ===================== */

  const handlePlayAll = () => {
    if (playlistTracks.length === 0) return;
    playPlaylist(playlistTracks, 0);
  };

  const handlePlayTrack = (_trackId: string, index: number) => {
    playPlaylist(playlistTracks, index);
  };

  const retry = () => {
    if (!artistKey) return;
    setReloadNonce((x) => x + 1);
  };

  const handleBack = () => navigate(-1);

  /* ===================== DATA LOAD ===================== */

  useEffect(() => {
    let active = true;

    async function load() {
      try {
        setLoading(true);
        const json = await fetchArtistByKey(artistKey, { force: reloadNonce > 0 });
        if (!active) return;

        if (isNotReady(json)) {
          setStatus("not_ready");
          return;
        }

        if (isOk(json)) {
          setStatus("ok");
          setPlaylists(json.playlists);
          setTracks(json.tracks);
          setArtistTitle(json.artist.artist_name || artistKey);
          setArtistMedia({
            thumbnail_url: json.artist.thumbnail_url,
            banner_url: json.artist.banner_url,
          });
          return;
        }

        if (isError(json)) throw new Error(json.error);
        throw new Error("Artist request failed");
      } catch (e: any) {
        if (active) setError(e.message);
      } finally {
        if (active) setLoading(false);
      }
    }

    if (artistKey) load();
    return () => {
      active = false;
    };
  }, [artistKey, reloadNonce]);

  /* ===================== UI ===================== */

  if (loading) {
    return <div className="p-4 pb-32 text-center opacity-60">Učitavanje…</div>;
  }

  if (error) {
    return (
      <div className="p-4 pb-32">
        <ErrorState title="Artist request failed" subtitle={error} onRetry={retry} />
      </div>
    );
  }

  const displayInitial = canonicalArtistName[0]?.toUpperCase() ?? "?";

  return (
    <div className="relative pb-32">
      <div className="absolute left-2 top-2 z-10">
        <Button variant="ghost" size="icon" onClick={handleBack}>
          <ArrowLeft className="h-5 w-5" />
        </Button>
      </div>

      {/* HEADER */}
      <div className="pt-6 px-4 text-center">
        <div className="flex justify-center mb-4">
          <div className="w-28 h-28 rounded-full overflow-hidden border">
            {artistMedia?.thumbnail_url ? (
              <img src={artistMedia.thumbnail_url} className="w-full h-full object-cover" />
            ) : (
              <div className="flex items-center justify-center h-full text-3xl">{displayInitial}</div>
            )}
          </div>
        </div>

        <h1 className="font-black text-[26px] truncate">{canonicalArtistName}</h1>
        <p className="text-sm opacity-70">
          {formatCount(tracks.length)} tracks • {formatCount(displayPlaylists.length)} playlists
        </p>

        <div className="flex justify-center mt-5">
          <button className="pm-cta-pill" onClick={handlePlayAll}>
            <span className="pm-cta-pill-inner">
              <Play className="w-5 h-5 mr-1" />
              Play all
            </span>
          </button>
        </div>
      </div>

      {/* PLAYLISTS */}
      <section className="mt-8 px-4">
        <div className="flex items-center gap-2 mb-4">
          <ListMusic className="w-5 h-5" />
          <h2 className="text-xl font-bold">Playlists</h2>
        </div>

        <ScrollArea>
          <div className="flex space-x-4 pb-4">
            {displayPlaylists.map((p) => (
              <div key={p.id} className="w-[140px]">
                <PlaylistCard
                  id={p.id}
                  title={p.title}
                  imageUrl={p.cover_url || "/placeholder.svg"}
                  description=""
                />
              </div>
            ))}
          </div>
          <ScrollBar orientation="horizontal" />
        </ScrollArea>
      </section>

      {/* TRACKS */}
      <section className="mt-8 px-4">
        <div className="flex items-center gap-2 mb-4">
          <Music className="w-5 h-5" />
          <h2 className="text-xl font-bold">Tracks</h2>
        </div>

        <div className="space-y-2">
          {tracks.map((t, index) => (
            <TrackCard
              key={t.id}
              id={t.id}
              title={cleanTrackTitle(t.title, canonicalArtistName)}
              artist={canonicalArtistName}
              imageUrl={t.cover_url}
              youtubeId={t.youtube_video_id}
              duration={t.duration ?? null}
              isActive={currentTrackId === t.id}
              onPlay={() => handlePlayTrack(t.id, index)}
            />
          ))}
        </div>
      </section>
    </div>
  );
}
