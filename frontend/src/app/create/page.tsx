"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient, type User } from "@supabase/supabase-js";
import PlaylistForm, { type PlaylistFormSubmitPayload } from "../../components/playlist/PlaylistForm";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error("NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY must be defined");
}

const supabase = createClient(supabaseUrl, supabaseAnonKey);

export default function CreatePlaylistPage() {
  const router = useRouter();
  const [user, setUser] = useState<User | null>(null);
  const [checkingAuth, setCheckingAuth] = useState(true);

  useEffect(() => {
    let isMounted = true;
    const resolveUser = async () => {
      try {
        const { data, error } = await supabase.auth.getUser();
        if (!isMounted) return;
        if (error) {
          console.error("Unable to fetch user", error);
          toast.error("Unable to verify your session.");
          router.replace("/login");
          return;
        }
        if (!data.user) {
          router.replace("/login?redirect=/create");
          return;
        }
        setUser(data.user);
      } finally {
        if (isMounted) setCheckingAuth(false);
      }
    };

    resolveUser();
    return () => {
      isMounted = false;
    };
  }, [router]);

  const handleCreate = async (payload: PlaylistFormSubmitPayload) => {
    if (!user) {
      throw new Error("You must be signed in to create playlists.");
    }

    const { data, error } = await supabase
      .from("playlists")
      .insert({
        title: payload.title,
        description: payload.description,
        cover_url: payload.cover_url,
        owner_id: user.id,
        region: payload.region_id,
        era: payload.era_id,
      })
      .select("id")
      .single();

    if (error || !data) {
      throw new Error(error?.message || "Failed to create playlist.");
    }

    const categoryIds = [...payload.genre_ids, ...payload.theme_ids];
    if (categoryIds.length) {
      const linkPayload = categoryIds.map((category_id) => ({ playlist_id: data.id, category_id }));
      const { error: linkError } = await supabase.from("playlist_categories").insert(linkPayload);
      if (linkError) {
        throw new Error(linkError.message || "Failed to link playlist categories.");
      }
    }

    toast.success("Playlist created");
    router.push(`/playlist/${data.id}`);
  };

  if (checkingAuth) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gradient-to-b from-[#050109] via-[#0d0519] to-[#030106] text-white">
        <Loader2 className="h-8 w-8 animate-spin" />
      </div>
    );
  }

  if (!user) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center bg-gradient-to-b from-[#050109] via-[#0d0519] to-[#030106] px-6 text-center text-white">
        <p className="text-lg text-white/70">Redirecting you to login...</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-b from-[#050109] via-[#0d0519] to-[#030106] px-6 py-16 text-white">
      <div className="mx-auto w-full max-w-5xl space-y-8">
        <div>
          <p className="text-sm uppercase tracking-[0.3em] text-white/50">PurpleMusic Studio</p>
          <h1 className="text-4xl font-bold">Create a playlist</h1>
          <p className="mt-2 text-white/70">Shape the vibe, set a cover, pin a region, and tag genres/themes so others can find your sound faster.</p>
        </div>
        <PlaylistForm mode="create" userId={user.id} onSubmit={handleCreate} />
      </div>
    </div>
  );
}
