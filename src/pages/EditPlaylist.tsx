// CLEANUP DIRECTIVE: Restoring the SPA edit playlist page with the shared PlaylistForm.
import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { Loader2, Music2, RotateCcw, Trash2 } from "lucide-react";
import { toast } from "sonner";
import PlaylistForm, {
  type PlaylistFormInitialData,
  type PlaylistFormSubmitPayload,
} from "@/components/playlist/PlaylistForm";
import { usePi } from "@/contexts/PiContext";
import { fetchWithPiAuth } from "@/lib/fetcher";

const normalizeNumber = (value: unknown): number | null => {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string" && value.trim().length > 0) {
    const parsed = Number(value);
    return Number.isNaN(parsed) ? null : parsed;
  }
  return null;
};

const toNumberArray = (value: unknown): number[] => {
  if (!Array.isArray(value)) {
    return [];
  }
  const unique = new Set<number>();
  value.forEach((entry) => {
    const normalized = normalizeNumber(entry);
    if (typeof normalized === "number") {
      unique.add(normalized);
    }
  });
  return Array.from(unique);
};

type StudioPlaylistResponse = {
  id: string;
  title: string;
  description: string | null;
  cover_url: string | null;
  region_id: number | null;
  era_id: number | null;
  genre_ids: number[];
  theme_ids: number[];
  is_public: boolean;
  tracks?: StudioPlaylistTrack[] | null;
  error?: string;
};

type StudioPlaylistTrack = {
  track_id: string;
  title: string | null;
  artist: string | null;
  cover_url: string | null;
  duration: number | null;
  external_id: string | null;
  position: number | null;
  added_at: string | null;
};

const EditPlaylist = () => {
  const navigate = useNavigate();
  const { id } = useParams<{ id: string }>();
  const { user, loading } = usePi();
  const [initialData, setInitialData] = useState<PlaylistFormInitialData | null>(null);
  const [pageError, setPageError] = useState<string | null>(null);
  const [pageLoading, setPageLoading] = useState(true);
  const [deleting, setDeleting] = useState(false);
  const [playlistTracks, setPlaylistTracks] = useState<StudioPlaylistTrack[]>([]);
  const [removeTrackIds, setRemoveTrackIds] = useState<string[]>([]);

  useEffect(() => {
    let cancelled = false;

    const loadPlaylist = async () => {
      if (!id) {
        setPageError("Missing playlist id.");
        setPageLoading(false);
        return;
      }

      if (!user) {
        if (!loading) {
          setPageError("Please sign in to edit playlists.");
          setPageLoading(false);
        }
        return;
      }

      setPageLoading(true);
      setPageError(null);

      try {
        const response = await fetchWithPiAuth(`/api/studio/playlists/${id}`);
        let payload: StudioPlaylistResponse | null = null;
        try {
          payload = (await response.json()) as StudioPlaylistResponse;
        } catch (_) {
          payload = null;
        }

        if (!response.ok || !payload) {
          throw new Error(payload?.error || "Failed to load playlist.");
        }

        const normalized: PlaylistFormInitialData = {
          id: payload.id,
          title: payload.title,
          description: payload.description,
          cover_url: payload.cover_url,
          region_id: normalizeNumber(payload.region_id),
          era_id: normalizeNumber(payload.era_id),
          genre_ids: toNumberArray(payload.genre_ids),
          theme_ids: toNumberArray(payload.theme_ids),
          is_public: typeof payload.is_public === "boolean" ? payload.is_public : Boolean(payload.is_public),
        };

        const normalizedTracks: StudioPlaylistTrack[] = Array.isArray(payload.tracks)
          ? payload.tracks.map((track, index) => ({
              track_id: track.track_id,
              title: track.title ?? null,
              artist: track.artist ?? null,
              cover_url: track.cover_url ?? null,
              duration: typeof track.duration === "number" ? track.duration : null,
              external_id: track.external_id ?? null,
              position: typeof track.position === "number" ? track.position : index,
              added_at: track.added_at ?? null,
            }))
          : [];

        if (!cancelled) {
          setInitialData(normalized);
          setPlaylistTracks(normalizedTracks);
          setRemoveTrackIds([]);
        }
      } catch (err) {
        if (!cancelled) {
          setPlaylistTracks([]);
          setRemoveTrackIds([]);
          setPageError(err instanceof Error ? err.message : "Failed to load playlist.");
        }
      } finally {
        if (!cancelled) {
          setPageLoading(false);
        }
      }
    };

    loadPlaylist();

    return () => {
      cancelled = true;
    };
  }, [id, user, loading]);

  const handleUpdate = async (payload: PlaylistFormSubmitPayload) => {
    if (!user || !id) {
      throw new Error("Missing playlist context.");
    }

    const response = await fetchWithPiAuth(`/api/studio/playlists/${id}`, {
      method: "PUT",
      body: JSON.stringify(payload),
    });

    let responseBody: StudioPlaylistResponse | { error?: string } | null = null;
    try {
      responseBody = await response.json();
    } catch (_) {
      responseBody = null;
    }

    if (!response.ok) {
      const message = (responseBody as { error?: string } | null)?.error || "Failed to update playlist.";
      throw new Error(message);
    }

    toast.success("Playlist updated");
    navigate(`/playlist/${id}`);
  };

  const handleToggleTrackRemoval = (trackId: string) => {
    setRemoveTrackIds((current) => {
      if (current.includes(trackId)) {
        return current.filter((id) => id !== trackId);
      }
      return [...current, trackId];
    });
  };

  const handleDelete = async () => {
    if (!user || !id) {
      toast.error("Missing playlist context.");
      return;
    }

    const confirmed = window.confirm("Are you sure you want to delete this playlist? This action cannot be undone.");
    if (!confirmed) return;

    setDeleting(true);

    try {
      const response = await fetchWithPiAuth(`/api/studio/playlists/${id}`, { method: "DELETE" });
      let payload: { success?: boolean; error?: string } | null = null;
      try {
        payload = await response.json();
      } catch (_) {
        payload = null;
      }

      if (!response.ok || payload?.success !== true) {
        const message = payload?.error || "Failed to delete playlist.";
        throw new Error(message);
      }

      toast.success("Playlist deleted");
      navigate("/library");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to delete playlist.";
      toast.error(message);
    } finally {
      setDeleting(false);
    }
  };

  if (pageLoading || loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gradient-to-b from-[#050109] via-[#0d0519] to-[#030106] text-white">
        <Loader2 className="h-8 w-8 animate-spin" />
      </div>
    );
  }

  if (pageError) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gradient-to-b from-[#050109] via-[#0d0519] to-[#030106] px-6 text-center text-white">
        <div className="space-y-4">
          <p className="text-lg font-semibold">{pageError}</p>
          <Link
            to="/library"
            className="inline-flex items-center justify-center rounded-full bg-yellow-400 px-6 py-3 font-semibold text-black shadow-lg shadow-yellow-500/40"
          >
            Return to Library
          </Link>
        </div>
      </div>
    );
  }

  if (!initialData || !user) {
    return null;
  }

  return (
    <div className="min-h-screen bg-gradient-to-b from-[#050109] via-[#0d0519] to-[#030106] px-6 py-16 text-white">
      <div className="mx-auto w-full max-w-5xl space-y-8">
        <div>
          <p className="text-sm uppercase tracking-[0.3em] text-white/50">PurpleMusic Studio</p>
          <h1 className="text-4xl font-bold">Edit playlist</h1>
          <p className="mt-2 text-white/70">Adjust the metadata, switch the vibe, or retag your playlist for discovery.</p>
        </div>
        <PlaylistForm
          mode="edit"
          userId={user.uid}
          initialData={initialData}
          onSubmit={handleUpdate}
          removeTrackIds={removeTrackIds}
          afterCoverSlot={
            <PlaylistTracksSlot
              tracks={playlistTracks}
              pendingRemovalIds={removeTrackIds}
              onToggleRemoval={handleToggleTrackRemoval}
            />
          }
        />
        <div className="rounded-3xl border border-red-500/30 bg-red-500/5 p-6 text-sm text-white/80">
          <h3 className="text-xl font-semibold text-white">Delete playlist</h3>
          <p className="mt-2 text-white/70">
            Removing this playlist will delete all of its songs and category tags. This action cannot be undone.
          </p>
          <button
            type="button"
            onClick={handleDelete}
            disabled={deleting}
            className="mt-4 inline-flex items-center justify-center rounded-full border border-red-400/60 bg-transparent px-6 py-3 text-sm font-semibold text-red-200 transition hover:bg-red-500/20 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {deleting ? "Deleting…" : "Delete playlist"}
          </button>
        </div>
      </div>
    </div>
  );
};

type PlaylistTracksSlotProps = {
  tracks: StudioPlaylistTrack[];
  pendingRemovalIds: string[];
  onToggleRemoval: (trackId: string) => void;
};

function PlaylistTracksSlot({ tracks, pendingRemovalIds, onToggleRemoval }: PlaylistTracksSlotProps) {
  if (!tracks.length) {
    return (
      <div className="rounded-3xl border border-white/15 bg-black/20 p-4 text-sm text-white/70">
        <p>No tracks in this playlist yet.</p>
        <p className="mt-1 text-xs text-white/40">Add songs from Studio to see them here.</p>
      </div>
    );
  }

  const sortedTracks = [...tracks].sort((a, b) => {
    const aPos = typeof a.position === "number" ? a.position : Number.MAX_SAFE_INTEGER;
    const bPos = typeof b.position === "number" ? b.position : Number.MAX_SAFE_INTEGER;
    return aPos - bPos;
  });

  return (
    <div className="rounded-3xl border border-white/15 bg-black/30 p-4 text-sm text-white">
      <div className="flex items-center justify-between text-[11px] uppercase tracking-[0.2em] text-white/50">
        <span>Playlist tracks</span>
        <span className={pendingRemovalIds.length ? "text-red-200" : "text-white/40"}>
          {pendingRemovalIds.length ? `${pendingRemovalIds.length} pending removal` : `${sortedTracks.length} total`}
        </span>
      </div>
      <div className="mt-4 flex max-h-[420px] flex-col gap-3 overflow-y-auto pr-1">
        {sortedTracks.map((track) => {
          const pending = pendingRemovalIds.includes(track.track_id);
          return (
            <div
              key={track.track_id}
              className={`flex items-center gap-3 rounded-2xl border px-3 py-2 ${
                pending ? "border-red-400/60 bg-red-500/10 text-white/80" : "border-white/10 bg-white/5"
              }`}
            >
              <div className="h-12 w-12 flex-shrink-0 overflow-hidden rounded-2xl bg-white/5">
                {track.cover_url ? (
                  <img src={track.cover_url} alt={track.title ?? "Track artwork"} className="h-full w-full object-cover" />
                ) : (
                  <div className="flex h-full w-full items-center justify-center text-white/40">
                    <Music2 className="h-5 w-5" />
                  </div>
                )}
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-white">{track.title ?? "Untitled track"}</p>
                <p className="truncate text-xs text-white/60">{track.artist ?? "Unknown artist"}</p>
                {pending ? <p className="text-[10px] uppercase text-red-200">Pending removal</p> : null}
              </div>
              <div className="flex flex-col items-end gap-1 text-right">
                <span className="text-xs text-white/60">{formatDuration(track.duration)}</span>
                <button
                  type="button"
                  onClick={() => onToggleRemoval(track.track_id)}
                  className={`inline-flex items-center gap-1 rounded-full border px-2 py-1 text-xs font-semibold transition ${
                    pending ? "border-red-300 text-red-200 hover:bg-red-500/10" : "border-white/20 text-white/80 hover:border-white/50"
                  }`}
                >
                  {pending ? <RotateCcw className="h-3.5 w-3.5" /> : <Trash2 className="h-3.5 w-3.5" />}
                  {pending ? "Undo" : "Remove"}
                </button>
              </div>
            </div>
          );
        })}
      </div>
      <p className="mt-3 text-[11px] text-white/50">
        {pendingRemovalIds.length ? "Save changes to confirm removals." : "Use the trash icon to queue removals."}
      </p>
    </div>
  );
}

const formatDuration = (duration: number | null): string => {
  if (typeof duration !== "number" || Number.isNaN(duration) || duration <= 0) {
    return "—";
  }
  const totalSeconds = duration > 1000 ? Math.round(duration / 1000) : Math.round(duration);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
};

export default EditPlaylist;
