// CLEANUP DIRECTIVE: Restoring the SPA create playlist page with the shared PlaylistForm.
import { Loader2 } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import PlaylistForm, { type PlaylistFormSubmitPayload } from "@/components/playlist/PlaylistForm";
import { externalSupabase } from "@/lib/externalSupabase";
import { usePi } from "@/contexts/PiContext";

const CreatePlaylist = () => {
  const navigate = useNavigate();
  const { user, loading } = usePi();

  const handleCreate = async (payload: PlaylistFormSubmitPayload) => {
    if (!user) {
      throw new Error("You must be signed in to create playlists.");
    }

    const { data, error } = await externalSupabase
      .from("playlists")
      .insert({
        title: payload.title,
        description: payload.description,
        cover_url: payload.cover_url,
        owner_id: user.uid,
        region: payload.region_id,
        era: payload.era_id,
      })
      .select("id")
      .single();

    if (error || !data) {
      throw new Error(error?.message || "Failed to create playlist.");
    }

    const categoryIds = Array.from(new Set(payload.category_groups?.all ?? []));
    if (categoryIds.length > 0) {
      const rows = categoryIds.map((category_id) => ({ playlist_id: data.id, category_id }));
      const { error: categoryError } = await externalSupabase.from("playlist_categories").insert(rows);
      if (categoryError) {
        throw new Error(categoryError.message || "Failed to link playlist categories.");
      }
    }

    toast.success("Playlist created");
    navigate(`/playlist/${data.id}`);
  };

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gradient-to-b from-[#050109] via-[#0d0519] to-[#030106] text-white">
        <Loader2 className="h-8 w-8 animate-spin" />
      </div>
    );
  }

  if (!user) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center bg-gradient-to-b from-[#050109] via-[#0d0519] to-[#030106] px-6 text-center text-white">
        <p className="text-lg text-white/70">Please sign in to create a playlist.</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-b from-[#050109] via-[#0d0519] to-[#030106] px-6 py-16 text-white">
      <div className="mx-auto w-full max-w-5xl space-y-8">
        <div>
          <p className="text-sm uppercase tracking-[0.3em] text-white/50">PurpleMusic Studio</p>
          <h1 className="text-4xl font-bold">Create a playlist</h1>
          <p className="mt-2 text-white/70">
            Shape the vibe, set a cover, pin a region, and tag genres/themes so others can find your sound faster.
          </p>
        </div>
        <PlaylistForm mode="create" userId={user.uid} onSubmit={handleCreate} />
      </div>
    </div>
  );
};

export default CreatePlaylist;
