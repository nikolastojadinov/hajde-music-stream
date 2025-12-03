import { useEffect, useMemo, useRef, useState, type ChangeEvent } from "react";
import { useNavigate } from "react-router-dom";
import type { User } from "@supabase/supabase-js";
import { Globe, Loader2, Lock, Upload, X } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

const coverBucket = import.meta.env.VITE_SUPABASE_COVER_BUCKET || "playlist-covers";

const CreatePlaylist = () => {
  const navigate = useNavigate();
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [coverFile, setCoverFile] = useState<File | null>(null);
  const [coverPreview, setCoverPreview] = useState<string | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [authChecked, setAuthChecked] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    let cancelled = false;
    supabase.auth.getUser().then(({ data, error }) => {
      if (cancelled) return;
      if (error) {
        console.error("Failed to resolve Supabase user", error);
        setFormError("Unable to verify your session. Please refresh and try again.");
      }
      setUser(data?.user ?? null);
      setAuthChecked(true);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    return () => {
      if (coverPreview) URL.revokeObjectURL(coverPreview);
    };
  }, [coverPreview]);

  const handleFilePick = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    setCoverFile(file);
    setCoverPreview(URL.createObjectURL(file));
  };

  const coverHint = useMemo(() => {
    if (!coverFile) return "Upload square cover";
    const kb = (coverFile.size / 1024).toFixed(0);
    return `${kb} KB • ${coverFile.type}`;
  }, [coverFile]);

  const ensureCanProceed = () => {
    if (!title.trim()) {
      setFormError("Playlist name is required.");
      toast.error("Add a playlist name before continuing.");
      return;
    }
    if (!user) {
      setFormError("Please sign in to create playlists.");
      toast.error("Please sign in first.");
      return;
    }
    setFormError(null);
    setModalOpen(true);
  };

  const uploadCoverIfNeeded = async (): Promise<string | null> => {
    if (!coverFile || !user) return null;
    const extension = coverFile.name.split(".").pop() || "jpg";
    const objectPath = `covers/${user.id}-${Date.now()}.${extension}`;
    const { error: uploadError } = await supabase.storage.from(coverBucket).upload(objectPath, coverFile, {
      cacheControl: "3600",
      upsert: true,
      contentType: coverFile.type,
    });
    if (uploadError) {
      console.error("Cover upload failed", uploadError);
      throw new Error("Unable to upload cover image. Please try again.");
    }
    const { data } = supabase.storage.from(coverBucket).getPublicUrl(objectPath);
    return data?.publicUrl ?? null;
  };

  const createPlaylist = async (isPublic: boolean) => {
    if (!user) return;
    setIsSaving(true);
    try {
      let coverUrl: string | null = null;
      if (coverFile) {
        coverUrl = await uploadCoverIfNeeded();
      }
      const { error } = await supabase.from("playlists").insert({
        title: title.trim(),
        description: description.trim() || null,
        cover_url: coverUrl,
        is_public: isPublic,
        owner_id: user.id,
        created_at: new Date().toISOString(),
      });
      if (error) {
        console.error("Playlist insert failed", error);
        throw new Error(error.message || "Unable to create playlist right now.");
      }
      toast.success("Playlist created");
      navigate("/library");
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unexpected error. Please try again.";
      setFormError(message);
      toast.error(message);
    } finally {
      setIsSaving(false);
      setModalOpen(false);
    }
  };

  if (!authChecked) {
    return (
      <div className="flex h-full min-h-screen items-center justify-center bg-gradient-to-b from-[#050109] via-[#0d0519] to-[#030106] text-white">
        <Loader2 className="h-8 w-8 animate-spin" />
      </div>
    );
  }

  if (!user) {
    return (
      <div className="flex h-full min-h-screen items-center justify-center bg-gradient-to-b from-[#050109] via-[#0d0519] to-[#030106] text-white px-6 text-center">
        <div className="space-y-6 max-w-lg">
          <h1 className="text-4xl font-semibold">Sign in required</h1>
          <p className="text-white/70">Connect your Pi account to craft playlists. Once you sign in, head back here to start building.</p>
          <button
            onClick={() => navigate("/library")}
            className="inline-flex items-center justify-center rounded-full bg-yellow-400 px-6 py-3 text-black font-semibold shadow-lg shadow-yellow-500/40"
          >
            Go to Library
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-b from-[#0B0415] via-[#120725] to-[#040108] text-white">
      <div className="mx-auto max-w-5xl px-6 pb-24 pt-16">
        <button
          onClick={() => navigate(-1)}
          className="text-sm uppercase tracking-wide text-white/60 transition hover:text-yellow-300"
        >
          Back
        </button>

        <div className="mt-8 space-y-6">
          <header>
            <p className="text-sm text-white/60">Playlist Builder</p>
            <h1 className="mt-1 text-4xl font-bold">Craft something fresh</h1>
            <p className="mt-2 max-w-2xl text-white/70">
              Name it, vibe it, upload a square cover, then pick if the world can stream it or if it stays private.
            </p>
          </header>

          <section className="space-y-8 rounded-3xl border border-white/10 bg-white/5 p-8 backdrop-blur-xl shadow-[0_20px_60px_rgba(0,0,0,0.45)]">
            <div className="flex flex-wrap gap-6">
              <div
                className="flex h-48 w-48 cursor-pointer items-center justify-center rounded-2xl border border-dashed border-white/30 bg-black/30 transition hover:border-yellow-300/60"
                onClick={() => fileInputRef.current?.click()}
              >
                {coverPreview ? (
                  <img src={coverPreview} alt="Cover preview" className="h-full w-full rounded-2xl object-cover" />
                ) : (
                  <div className="flex flex-col items-center text-center text-white/60">
                    <Upload className="mb-3 h-10 w-10 text-yellow-300" />
                    <p className="text-sm">Upload square cover</p>
                    <span className="text-xs text-white/40">PNG / JPG</span>
                  </div>
                )}
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/png,image/jpeg,image/webp"
                  className="hidden"
                  onChange={handleFilePick}
                />
              </div>

              <div className="min-w-[240px] flex-1 space-y-6">
                <div>
                  <label htmlFor="playlist-title" className="text-sm uppercase tracking-wide text-white/60">
                    Playlist name
                  </label>
                  <input
                    id="playlist-title"
                    type="text"
                    value={title}
                    onChange={(event) => setTitle(event.target.value)}
                    placeholder="Purple Midnight Energy"
                    className="mt-2 w-full rounded-2xl border border-white/10 bg-black/30 px-4 py-3 text-lg outline-none focus:border-yellow-300 focus:ring-2 focus:ring-yellow-400/40"
                  />
                </div>

                <div>
                  <label htmlFor="playlist-description" className="text-sm uppercase tracking-wide text-white/60">
                    Description (optional)
                  </label>
                  <textarea
                    id="playlist-description"
                    value={description}
                    onChange={(event) => setDescription(event.target.value)}
                    placeholder="Tell your listeners what this playlist feels like..."
                    rows={4}
                    className="mt-2 w-full rounded-2xl border border-white/10 bg-black/30 px-4 py-3 text-base outline-none focus:border-yellow-300 focus:ring-2 focus:ring-yellow-400/40"
                  />
                </div>
              </div>
            </div>

            {coverFile ? (
              <p className="text-sm text-white/50">{coverHint}</p>
            ) : null}

            {formError ? (
              <div className="rounded-2xl border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm text-red-200">
                {formError}
              </div>
            ) : null}

            <div className="flex flex-wrap items-center justify-between gap-4">
              <p className="text-sm text-white/60">
                Public playlists appear in Search. Private ones stay in your Library.
              </p>
              <button
                onClick={ensureCanProceed}
                disabled={!title.trim() || isSaving}
                className="inline-flex items-center gap-2 rounded-full bg-gradient-to-r from-yellow-300 via-yellow-400 to-orange-400 px-6 py-3 font-semibold text-black shadow-lg shadow-yellow-500/40 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {isSaving ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" /> Creating...
                  </>
                ) : (
                  "Create playlist"
                )}
              </button>
            </div>
          </section>
        </div>
      </div>

      <VisibilityModal
        open={modalOpen}
        busy={isSaving}
        onCancel={() => setModalOpen(false)}
        onSelect={createPlaylist}
      />
    </div>
  );
};

const VisibilityModal = ({
  open,
  busy,
  onCancel,
  onSelect,
}: {
  open: boolean;
  busy: boolean;
  onCancel: () => void;
  onSelect: (isPublic: boolean) => void;
}) => {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center px-4">
      <div className="absolute inset-0 bg-black/80 backdrop-blur-sm" onClick={onCancel} />
      <div className="relative w-full max-w-md rounded-3xl border border-white/10 bg-[#120725] p-6 text-white shadow-2xl">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-xs uppercase tracking-[0.3em] text-white/50">Visibility</p>
            <h2 className="text-2xl font-semibold">Who can tune in?</h2>
            <p className="mt-1 text-sm text-white/70">Pick how this playlist shows up across PurpleMusic.</p>
          </div>
          <button onClick={onCancel} className="rounded-full p-2 text-white/60 hover:bg-white/10 hover:text-white">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="mt-6 space-y-4">
          <button
            disabled={busy}
            onClick={() => onSelect(true)}
            className="w-full rounded-2xl border border-white/15 bg-white/5 px-4 py-4 text-left transition hover:border-yellow-300/70 disabled:opacity-60"
          >
            <div className="flex items-center gap-3">
              <span className="rounded-full bg-yellow-400/20 p-2 text-yellow-300">
                <Globe className="h-5 w-5" />
              </span>
              <div>
                <p className="font-semibold">Public</p>
                <p className="text-sm text-white/70">Appears in Search and curated mixes.</p>
              </div>
            </div>
          </button>

          <button
            disabled={busy}
            onClick={() => onSelect(false)}
            className="w-full rounded-2xl border border-white/15 bg-white/5 px-4 py-4 text-left transition hover:border-purple-200/40 disabled:opacity-60"
          >
            <div className="flex items-center gap-3">
              <span className="rounded-full bg-purple-500/20 p-2 text-purple-200">
                <Lock className="h-5 w-5" />
              </span>
              <div>
                <p className="font-semibold">Private</p>
                <p className="text-sm text-white/70">Only you will see it inside Library.</p>
              </div>
            </div>
          </button>
        </div>

        <button
          onClick={onCancel}
          disabled={busy}
          className="mt-6 w-full rounded-full border border-white/20 py-2 text-sm font-semibold text-white/70 hover:text-white"
        >
          {busy ? "Please wait" : "Cancel"}
        </button>
      </div>
    </div>
  );
};

export default CreatePlaylist;
