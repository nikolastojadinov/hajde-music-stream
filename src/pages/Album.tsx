import { useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import { PlaylistHeader } from "@/components/PlaylistHeader";
import { TrackRow } from "@/components/TrackRow";
import { usePlayer } from "@/contexts/PlayerContext";
import { getBackendHeaders } from "@/contexts/PiContext";
import { withBackendOrigin } from "@/lib/backendUrl";

// Backend album payload shape
type AlbumApiResponse = {
  id: string;
  title: string;
  subtitle: string;
  thumbnail: string | null;
  tracks: Array<{ videoId: string; title: string; artist: string; duration: string; thumbnail: string | null }>;
};

type AlbumMeta = { title: string; subtitle: string; thumbnail: string | null };

type SupabaseTrackRow = {
  position: number | null;
  tracks: { id: string | null; title: string | null; artist: string | null; duration: number | null; cover_url: string | null } | null;
};

type FetchedAlbum = { meta: AlbumMeta; tracks: AlbumApiResponse["tracks"] };

const normalize = (value: unknown): string => (typeof value === "string" ? value.trim() : "");

const isVideoId = (value: string | undefined | null): value is string => typeof value === "string" && /^[A-Za-z0-9_-]{11}$/.test(value.trim());

const formatDuration = (value: string | number | null | undefined): string => {
  if (typeof value === "string" && value.includes(":")) return value.trim();
  const seconds = typeof value === "number" && Number.isFinite(value) ? Math.max(0, Math.trunc(value)) : null;
  if (seconds === null) return "";
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${mins}:${secs.toString().padStart(2, "0")}`;
};

const buildSupabase = (): SupabaseClient | null => {
  const url = normalize(import.meta.env.VITE_SUPABASE_URL);
  const key = normalize(import.meta.env.VITE_SUPABASE_ANON_KEY || import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY);
  if (!url || !key) return null;
  return createClient(url, key);
};

async function fetchBackendAlbum(browseId: string): Promise<FetchedAlbum | null> {
  const url = withBackendOrigin(`/api/browse/album?browseId=${encodeURIComponent(browseId)}`);
  const res = await fetch(url, {
    method: "GET",
    headers: { Accept: "application/json", ...(await getBackendHeaders()) },
    credentials: "include",
  });

  const json = (await res.json().catch(() => ({}))) as Partial<AlbumApiResponse> & { error?: string };
  if (!res.ok) throw new Error(typeof json.error === "string" ? json.error : "Album fetch failed");

  const meta: AlbumMeta = {
    title: normalize(json.title) || browseId,
    subtitle: normalize(json.subtitle) || "Album",
    thumbnail: normalize(json.thumbnail) || null,
  };

  const tracks = Array.isArray(json.tracks) ? json.tracks : [];
  return { meta, tracks };
}

async function fetchSupabaseAlbum(client: SupabaseClient | null, externalId: string): Promise<FetchedAlbum | null> {
  if (!client) return null;

  const { data: albumRow, error: albumErr } = await client
    .from("albums")
    .select("id,title,cover_url,external_id")
    .eq("external_id", externalId)
    .maybeSingle();

  if (albumErr || !albumRow) return null;

  const { data: trackRows, error: trackErr } = await client
    .from("album_tracks")
    .select("position, tracks:tracks(*)")
    .eq("album_id", albumRow.id)
    .order("position", { ascending: true });

  if (trackErr || !Array.isArray(trackRows)) return null;

  const tracks: AlbumApiResponse["tracks"] = (trackRows as SupabaseTrackRow[])
    .map((row) => {
      const track = row.tracks;
      const videoId = normalize(track?.id);
      if (!videoId) return null;
      return {
        videoId,
        title: normalize(track?.title) || "Untitled",
        artist: normalize(track?.artist),
        duration: formatDuration(track?.duration),
        thumbnail: normalize(track?.cover_url) || null,
      };
    })
    .filter(Boolean) as AlbumApiResponse["tracks"];

  const meta: AlbumMeta = {
    title: normalize(albumRow.title) || externalId,
    subtitle: "Album",
    thumbnail: normalize(albumRow.cover_url) || null,
  };

  return { meta, tracks };
}

export default function AlbumPage() {
  const { id } = useParams();
  const albumId = normalize(id);
  const location = useLocation();
  const navigate = useNavigate();
  const { playCollection } = usePlayer();

  const state = (location.state || {}) as {
    externalId?: string;
    snapshot?: { title?: string; subtitle?: string | null; imageUrl?: string | null };
  };
  const snapshotTitle = normalize(state.snapshot?.title);
  const snapshotSubtitle = normalize(state.snapshot?.subtitle);
  const snapshotImage = state.snapshot?.imageUrl ?? null;

  const supabase = useMemo(() => buildSupabase(), []);

  const [meta, setMeta] = useState<AlbumMeta>({
    title: snapshotTitle || albumId,
    subtitle: snapshotSubtitle || "Album",
    thumbnail: snapshotImage,
  });
  const [tracks, setTracks] = useState<AlbumApiResponse["tracks"]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!albumId) return;

    setMeta({ title: snapshotTitle || albumId, subtitle: snapshotSubtitle || "Album", thumbnail: snapshotImage });
    setTracks([]);
    setError(null);

    const controller = new AbortController();

    const load = async () => {
      setLoading(true);
      try {
        // 1) Backend first
        const backend = await fetchBackendAlbum(albumId);
        if (controller.signal.aborted) return;

        if (backend && backend.tracks.length > 0) {
          setMeta(backend.meta);
          setTracks(backend.tracks);
          return;
        }

        // 2) Supabase fallback when backend has no tracks
        const supabaseResult = await fetchSupabaseAlbum(supabase, albumId);
        if (controller.signal.aborted) return;

        if (supabaseResult && supabaseResult.tracks.length > 0) {
          setMeta((prev) => ({
            title: supabaseResult.meta.title || prev.title,
            subtitle: supabaseResult.meta.subtitle || prev.subtitle,
            thumbnail: supabaseResult.meta.thumbnail || prev.thumbnail,
          }));
          setTracks(supabaseResult.tracks);
          return;
        }

        // Keep backend meta even if empty
        if (backend) {
          setMeta((prev) => ({
            title: backend.meta.title || prev.title,
            subtitle: backend.meta.subtitle || prev.subtitle,
            thumbnail: backend.meta.thumbnail || prev.thumbnail,
          }));
          setTracks([]);
        }
      } catch (err: any) {
        if (controller.signal.aborted) return;
        setError(err?.message || "Album fetch failed");
        setTracks([]);
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    };

    void load();
    return () => controller.abort();
  }, [albumId, snapshotImage, snapshotSubtitle, snapshotTitle, supabase]);

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
            <div className="px-6 py-10 text-center text-sm text-neutral-400">No tracks found</div>
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
