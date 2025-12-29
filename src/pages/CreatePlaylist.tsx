import { Loader2 } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import PlaylistForm, { type PlaylistFormSubmitPayload } from "@/components/playlist/PlaylistForm";
import { usePi } from "@/contexts/PiContext";
import { requirePiBrowser } from "@/lib/piBrowser";
import { fetchWithPiAuth } from "@/lib/fetcher";

const CreatePlaylist = () => {
  const navigate = useNavigate();
  const { user, loading } = usePi();

  const envCheck = requirePiBrowser();
  const isPi = envCheck.ok;

  const handleCreate = async (payload: PlaylistFormSubmitPayload) => {
    if (!isPi) {
      toast.error("Open this app in Pi Browser to create playlists.");
      return;
    }

    if (!user) {
      throw new Error("You must be signed in to create playlists.");
    }

    const response = await fetchWithPiAuth("/api/studio/playlists", {
      method: "POST",
      body: JSON.stringify(payload),
    });

    let responseBody: any = null;
    try {
      responseBody = await response.json();
    } catch (_) {}

    if (!response.ok || !responseBody || !("id" in responseBody)) {
      const message =
        responseBody?.error ||
        responseBody?.message ||
        "Unable to create playlist.";
      throw new Error(message);
    }

    if (import.meta.env.DEV) {
      console.debug("[CreatePlaylist] Playlist created", responseBody);
    }

    toast.success("Playlist created");
    navigate("/library");
  };

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[radial-gradient(circle_at_50%_20%,rgba(124,58,237,0.18),transparent_40%),linear-gradient(180deg,#07060B,#0B0814)] text-[#F3F1FF]">
        <Loader2 className="h-8 w-8 animate-spin" />
      </div>
    );
  }

  if (!isPi) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center bg-[radial-gradient(circle_at_50%_20%,rgba(124,58,237,0.18),transparent_40%),linear-gradient(180deg,#07060B,#0B0814)] px-8 text-center text-[#F3F1FF]">
        <h1 className="mb-4 text-3xl font-bold text-[#F6C66D]">Pi Browser Required</h1>
        <p className="mb-8 max-w-lg text-[#B7B2CC]">
          This feature requires the Pi Browser environment.  
          Please open this app inside Pi Browser to continue.
        </p>

        <a
          href="pi://app"
          className="rounded-lg bg-gradient-to-r from-yellow-400 to-orange-400 px-6 py-3 font-semibold text-black shadow-lg"
        >
          Open in Pi Browser
        </a>
      </div>
    );
  }

  if (!user) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center bg-[radial-gradient(circle_at_50%_20%,rgba(124,58,237,0.18),transparent_40%),linear-gradient(180deg,#07060B,#0B0814)] px-6 text-center text-[#F3F1FF]">
        <p className="text-lg text-[#B7B2CC]">
          Please sign in to create a playlist.
        </p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[radial-gradient(circle_at_50%_20%,rgba(124,58,237,0.18),transparent_40%),linear-gradient(180deg,#07060B,#0B0814)] px-6 py-16 text-[#F3F1FF]">
      <div className="mx-auto w-full max-w-5xl space-y-10">
        <div className="space-y-3">
          <p className="text-xs uppercase tracking-[0.32em] text-[#8B86A3]">PurpleMusic Studio</p>
          <h1 className="text-[34px] font-bold text-[#F6C66D] leading-tight">Create a playlist</h1>
          <p className="text-sm text-[#B7B2CC]">
            Shape the vibe, set a cover, pin a region, and tag genres/themes so others can find your sound faster.
          </p>
        </div>

        <PlaylistForm
          mode="create"
          userId={user.uid}
          onSubmit={handleCreate}
        />
      </div>
    </div>
  );
};

export default CreatePlaylist;
