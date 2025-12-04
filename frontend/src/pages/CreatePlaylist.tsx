import { Loader2 } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import PlaylistForm, { type PlaylistFormSubmitPayload } from "@/components/playlist/PlaylistForm";
import { withBackendOrigin } from "@/lib/backendUrl";
import { usePi } from "@/contexts/PiContext";
import { requirePiBrowser } from "@/lib/piBrowser";

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

    const url = withBackendOrigin("/api/studio/playlists");
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
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
      <div className="flex min-h-screen items-center justify-center bg-gradient-to-b from-[#050109] via-[#0d0519] to-[#030106] text-white">
        <Loader2 className="h-8 w-8 animate-spin" />
      </div>
    );
  }

  if (!isPi) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center bg-gradient-to-b from-[#050109] via-[#0d0519] to-[#030106] px-8 text-center text-white">
        <h1 className="mb-4 text-3xl font-bold">Pi Browser Required</h1>
        <p className="mb-8 max-w-lg text-white/80">
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
      <div className="flex min-h-screen flex-col items-center justify-center bg-gradient-to-b from-[#050109] via-[#0d0519] to-[#030106] px-6 text-center text-white">
        <p className="text-lg text-white/70">
          Please sign in to create a playlist.
        </p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-b from-[#050109] via-[#0d0519] to-[#030106] px-6 py-16 text-white">
      <div className="mx-auto w-full max-w-5xl space-y-8">
        <div>
          <p className="text-sm uppercase tracking-[0.3em] text-white/50">
            PurpleMusic Studio
          </p>
          <h1 className="text-4xl font-bold">Create a playlist</h1>
          <p className="mt-2 text-white/70">
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
