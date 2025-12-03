"use client";

import { useEffect, useRef, useState, type ChangeEvent } from "react";
import { useRouter } from "next/navigation";
import { createClient, type User } from "@supabase/supabase-js";
import { Upload, Loader2, Globe, Lock, X } from "lucide-react";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const coverBucket = process.env.NEXT_PUBLIC_SUPABASE_COVER_BUCKET || "playlist-covers";

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error("Missing Supabase environment variables");
}

const supabase = createClient(supabaseUrl, supabaseAnonKey);

export default function CreatePlaylistPage() {
  const router = useRouter();
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [coverFile, setCoverFile] = useState<File | null>(null);
  const [coverPreview, setCoverPreview] = useState<string | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // Resolve authenticated user once on mount so owner_id is correct.
  useEffect(() => {
    let cancelled = false;
    supabase.auth.getUser().then(({ data, error: authError }) => {
      if (cancelled) return;
      if (authError) {
        console.error("Unable to fetch user", authError);
        setError("Unable to verify your session. Please refresh and try again.");
      }
      setUser(data?.user ?? null);
      setAuthReady(true);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  // Revoke blob previews to dodge memory leaks.
  useEffect(() => {
    return () => {
      if (coverPreview) {
        URL.revokeObjectURL(coverPreview);
      }
    };
  }, [coverPreview]);

  const handleFilePick = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    setCoverFile(file);
    setCoverPreview(URL.createObjectURL(file));
  };

  const ensureTitleBeforeModal = () => {
    if (!title.trim()) {
      setError("Playlist name is required before continuing.");
      return;
    }
    if (!user) {
      setError("Please sign in to create a playlist.");
      return;
    }
    setError(null);
    setModalOpen(true);
  };

  const uploadCoverIfNeeded = async (): Promise<string | null> => {
    if (!coverFile || !user) {
      return null;
    }
    const extension = coverFile.name.split(".").pop() || "jpg";
    const objectPath = `covers/${user.id}-${Date.now()}.${extension}`;

    const { error: uploadError } = await supabase.storage
      .from(coverBucket)
      .upload(objectPath, coverFile, {
        cacheControl: "3600",
        upsert: true,
        contentType: coverFile.type,
      });

    if (uploadError) {
      console.error("Cover upload failed", uploadError);
      throw new Error("We could not upload your cover image. Please try again.");
    }

    const { data } = supabase.storage.from(coverBucket).getPublicUrl(objectPath);
    return data?.publicUrl ?? null;
  };

  const createPlaylist = async (isPublic: boolean) => {
    setIsSaving(true);
    setError(null);

    try {
      let coverUrl: string | null = null;
      if (coverFile) {
        coverUrl = await uploadCoverIfNeeded();
      }

      const { error: insertError } = await supabase.from("playlists").insert({
        title: title.trim(),
        description: description.trim() || null,
        cover_url: coverUrl,
        is_public: isPublic,
        owner_id: user.id,
        created_at: new Date().toISOString(),
      });

      if (insertError) {
        throw insertError;
      }

      setModalOpen(false);
      router.push("/library");
    } catch (err) {
      console.error("Playlist creation failed", err);
      setError(err instanceof Error ? err.message : "Unexpected error. Please try again.");
    } finally {
      setIsSaving(false);
    }
  };

  if (!authReady) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-black text-white">
        <Loader2 className="h-6 w-6 animate-spin" />
      </div>
    );
  }

  if (!user) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-b from-[#08030E] to-[#120624] text-white">
        <div className="text-center space-y-4">
          <h1 className="text-3xl font-semibold">Sign in required</h1>
          <p className="text-white/70 max-w-md">
            You need to be signed in with your Pi account before creating playlists.
          </p>
          <button
            onClick={() => router.push("/library")}
            className="px-6 py-2 rounded-full bg-yellow-400/90 text-black font-semibold shadow-lg shadow-yellow-500/30"
          >
            Go back to Library
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-b from-[#0B0415] via-[#120725] to-[#040108] text-white">
      <div className="max-w-4xl mx-auto px-6 pt-16 pb-24">
        <button
          onClick={() => router.back()}
          className="text-sm uppercase tracking-wide text-white/60 hover:text-yellow-300 transition"
        >
          Back
        </button>

        <div className="mt-8 space-y-6">
          <div>
            <p className="text-sm text-white/60">Playlist Builder</p>
            <h1 className="text-4xl font-bold mt-1">Craft something fresh</h1>
            <p className="text-white/70 mt-2 max-w-2xl">
              Name it, vibe it, upload a square cover, then pick if the world can stream it or if it stays private.
            </p>
          </div>

          <div className="rounded-3xl border border-white/10 bg-white/5 backdrop-blur-xl p-8 shadow-[0_20px_60px_rgba(0,0,0,0.45)] space-y-8">
            <section className="flex flex-wrap gap-6">
              <div
                className="w-48 h-48 rounded-2xl border border-dashed border-white/30 bg-black/30 flex items-center justify-center cursor-pointer hover:border-yellow-300/60 transition relative"
                onClick={() => fileInputRef.current?.click()}
              >
                {coverPreview ? (
                  <img src={coverPreview} alt="Cover preview" className="w-full h-full object-cover rounded-2xl" />
                ) : (
                  <div className="flex flex-col items-center text-center text-white/60">
                    <Upload className="h-10 w-10 mb-3 text-yellow-300" />
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

              <div className="flex-1 min-w-[240px] space-y-6">
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
            </section>

            {error ? (
              <div className="rounded-2xl border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm text-red-200">
                {error}
              </div>
            ) : null}

            <div className="flex flex-wrap items-center justify-between gap-4">
              <div className="text-white/60 text-sm">
                Public playlists appear in Search. Private ones stay in your Library.
              </div>
              <button
                onClick={ensureTitleBeforeModal}
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
          </div>
        </div>
      </div>

      <VisibilityModal
        open={modalOpen}
        onCancel={() => setModalOpen(false)}
        onSelect={createPlaylist}
        busy={isSaving}
      />
    </div>
  );
}

type VisibilityModalProps = {
  open: boolean;
  busy: boolean;
  onCancel: () => void;
  onSelect: (isPublic: boolean) => void;
};

function VisibilityModal({ open, busy, onCancel, onSelect }: VisibilityModalProps) {
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center px-4">
      <div className="absolute inset-0 bg-black/80 backdrop-blur-sm" onClick={onCancel} />
      <div className="relative w-full max-w-md rounded-3xl border border-white/10 bg-[#120725] p-6 text-white shadow-2xl">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-xs uppercase tracking-[0.3em] text-white/50">Visibility</p>
            <h2 className="text-2xl font-semibold">Who can tune in?</h2>
            <p className="text-sm text-white/70 mt-1">Pick how this playlist shows up across PurpleMusic.</p>
          </div>
          <button
            onClick={onCancel}
            className="rounded-full p-2 text-white/60 hover:text-white hover:bg-white/10"
            aria-label="Close modal"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="mt-6 space-y-4">
          <button
            disabled={busy}
            onClick={() => onSelect(true)}
            className="w-full rounded-2xl border border-white/15 bg-white/5 px-4 py-4 text-left hover:border-yellow-300/70 transition disabled:opacity-60"
          >
            <div className="flex items-center gap-3">
              <div className="rounded-full bg-yellow-400/20 p-2 text-yellow-300">
                <Globe className="h-5 w-5" />
              </div>
              <div>
                <p className="font-semibold">Public</p>
                <p className="text-sm text-white/70">Appears in Search and curated mixes.</p>
              </div>
            </div>
          </button>

          <button
            disabled={busy}
            onClick={() => onSelect(false)}
            className="w-full rounded-2xl border border-white/15 bg-white/5 px-4 py-4 text-left hover:border-purple-200/40 transition disabled:opacity-60"
          >
            <div className="flex items-center gap-3">
              <div className="rounded-full bg-purple-500/20 p-2 text-purple-200">
                <Lock className="h-5 w-5" />
              </div>
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
}
