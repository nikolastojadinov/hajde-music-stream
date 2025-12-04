// CLEANUP DIRECTIVE: Restoring the SPA edit playlist page with the shared PlaylistForm.
import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import PlaylistForm, {
  type PlaylistFormInitialData,
  type PlaylistFormSubmitPayload,
} from "@/components/playlist/PlaylistForm";
import { usePi } from "@/contexts/PiContext";
import { externalSupabase } from "@/lib/externalSupabase";
import { fetchOwnerProfile } from "@/lib/ownerProfile";

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

const EditPlaylist = () => {
  const navigate = useNavigate();
  const { id } = useParams<{ id: string }>();
  const { user, loading } = usePi();
  const [initialData, setInitialData] = useState<PlaylistFormInitialData | null>(null);
  const [pageError, setPageError] = useState<string | null>(null);
  const [pageLoading, setPageLoading] = useState(true);

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
        const profile = await fetchOwnerProfile();
        if (cancelled) {
          return;
        }
        if (!profile?.owner_id) {
          throw new Error("Unable to resolve your account. Please sign out and try again.");
        }

        const ownerId = profile.owner_id;

        const { data, error } = await externalSupabase
          .from("playlists")
          .select("id,title,description,cover_url,owner_id,region,era,is_public")
          .eq("id", id)
          .single();

        if (error || !data) {
          throw new Error(error?.message || "Playlist not found.");
        }

        if (data.owner_id !== ownerId) {
          throw new Error("You do not have permission to edit this playlist.");
        }

        const { data: links, error: linksError } = await externalSupabase
          .from("playlist_categories")
          .select("category_id,categories!inner(group_type)")
          .eq("playlist_id", id);

        if (linksError) {
          throw new Error(linksError.message || "Failed to load playlist categories.");
        }

        const genreIds: number[] = [];
        const themeIds: number[] = [];

        (links ?? []).forEach((link) => {
          const parsedId = normalizeNumber(link.category_id);
          if (!parsedId) return;
          const group = link.categories?.group_type ?? "";
          if (group === "genre") {
            genreIds.push(parsedId);
          }
          if (group === "theme") {
            themeIds.push(parsedId);
          }
        });

        const normalized: PlaylistFormInitialData = {
          id: data.id,
          title: data.title,
          description: data.description,
          cover_url: data.cover_url,
          region_id: normalizeNumber(data.region),
          era_id: normalizeNumber(data.era),
          genre_ids: Array.from(new Set(genreIds)),
          theme_ids: Array.from(new Set(themeIds)),
          is_public: typeof data.is_public === "boolean" ? data.is_public : Boolean(data.is_public),
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

    const { error: updateError } = await externalSupabase
      .from("playlists")
      .update({
        title: payload.title,
        description: payload.description,
        cover_url: payload.cover_url,
        region: payload.region_id,
        era: payload.era_id,
        is_public: payload.is_public,
      })
      .eq("id", id);

    if (updateError) {
      throw new Error(updateError.message || "Failed to update playlist.");
    }

    const { error: deleteError } = await externalSupabase
      .from("playlist_categories")
      .delete()
      .eq("playlist_id", id);

    if (deleteError) {
      throw new Error(deleteError.message || "Failed to reset playlist categories.");
    }

    const categoryIds = Array.from(new Set(payload.category_groups?.all ?? []));
    if (categoryIds.length > 0) {
      const rows = categoryIds.map((category_id) => ({ playlist_id: id, category_id }));
      const { error: insertError } = await externalSupabase.from("playlist_categories").insert(rows);
      if (insertError) {
        throw new Error(insertError.message || "Failed to apply playlist categories.");
      }
    }

    toast.success("Playlist updated");
    navigate(`/playlist/${id}`);
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
      </div>
    </div>
  );
};

export default EditPlaylist;
