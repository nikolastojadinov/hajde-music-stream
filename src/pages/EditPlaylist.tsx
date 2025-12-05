// CLEANUP DIRECTIVE: Restoring the SPA edit playlist page with the shared PlaylistForm.
import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { Loader2 } from "lucide-react";
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
  error?: string;
};

const EditPlaylist = () => {
  const navigate = useNavigate();
  const { id } = useParams<{ id: string }>();
  const { user, loading } = usePi();
  const [initialData, setInitialData] = useState<PlaylistFormInitialData | null>(null);
  const [pageError, setPageError] = useState<string | null>(null);
  const [pageLoading, setPageLoading] = useState(true);
  const [deleting, setDeleting] = useState(false);

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

        if (!cancelled) {
          setInitialData(normalized);
        }
      } catch (err) {
        if (!cancelled) {
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
        <PlaylistForm mode="edit" userId={user.uid} initialData={initialData} onSubmit={handleUpdate} />
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

export default EditPlaylist;
