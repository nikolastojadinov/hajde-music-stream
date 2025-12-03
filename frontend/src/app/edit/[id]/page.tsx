"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { createClient, type User } from "@supabase/supabase-js";
import PlaylistForm, { type PlaylistFormInitialData, type PlaylistFormSubmitPayload } from "../../../components/playlist/PlaylistForm";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error("NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY must be defined");
}

const supabase = createClient(supabaseUrl, supabaseAnonKey);

export default function EditPlaylistPage() {
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const playlistId = params?.id;
  const [user, setUser] = useState<User | null>(null);
  const [initialData, setInitialData] = useState<PlaylistFormInitialData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let isMounted = true;
    const load = async () => {
      if (!playlistId) {
        setError("Missing playlist id");
        setLoading(false);
        return;
      }

      try {
        const { data: authData, error: authError } = await supabase.auth.getUser();
        if (!isMounted) return;
        if (authError) {
          console.error("Unable to fetch user", authError);
          toast.error("Unable to verify your session.");
          router.replace("/login");
          return;
        }
        if (!authData.user) {
          router.replace(`/login?redirect=/edit/${playlistId}`);
          return;
        }
        setUser(authData.user);

        const { data: playlist, error: playlistError } = await supabase
          .from("playlists")
          .select("id,title,description,cover_url,owner_id,region,era")
          .eq("id", playlistId)
          .single();

        if (playlistError || !playlist) {
          setError(playlistError?.message || "Playlist not found");
          return;
        }

        if (playlist.owner_id !== authData.user.id) {
          setError("You do not have permission to edit this playlist.");
          return;
        }

        const { data: links, error: linksError } = await supabase
          .from("playlist_categories")
          .select("category_id,categories!inner(group_type)")
          .eq("playlist_id", playlistId);

        if (linksError) {
          setError(linksError.message || "Failed to load playlist categories.");
          return;
        }

        const normalizeId = (value: unknown) => {
          if (value === null || value === undefined) return null;
          if (typeof value === "number") return value;
          if (typeof value === "string") return Number(value);
          return null;
        };

        const genreIds: number[] = [];
        const themeIds: number[] = [];
        (links ?? []).forEach((link) => {
          const parsedId = normalizeId(link.category_id);
          if (!parsedId) return;
          const group = (link.categories?.group_type ?? "") as string;
          if (group === "genre") {
            genreIds.push(parsedId);
          } else if (group === "theme") {
            themeIds.push(parsedId);
          }
        });

        const normalized: PlaylistFormInitialData = {
          id: playlist.id,
          title: playlist.title,
          description: playlist.description,
          cover_url: playlist.cover_url,
          region_id: normalizeId(playlist.region),
          era_id: normalizeId(playlist.era),
          genre_ids: genreIds,
          theme_ids: themeIds,
        };

        setInitialData(normalized);
      } finally {
        if (isMounted) setLoading(false);
      }
    };

    load();
    return () => {
      isMounted = false;
    };
  }, [playlistId, router]);

  const handleUpdate = async (payload: PlaylistFormSubmitPayload) => {
    if (!user || !initialData) {
      throw new Error("Missing playlist context");
    }

    const { error: updateError } = await supabase
      .from("playlists")
      .update({
        title: payload.title,
        description: payload.description,
        cover_url: payload.cover_url,
        region: payload.region_id,
        era: payload.era_id,
      })
      .eq("id", initialData.id);

    if (updateError) {
      throw new Error(updateError.message || "Failed to update playlist.");
    }

    const { error: deleteError } = await supabase
      .from("playlist_categories")
      .delete()
      .eq("playlist_id", initialData.id);

    if (deleteError) {
      throw new Error(deleteError.message || "Failed to reset playlist categories.");
    }

    const categoryIds = [...payload.genre_ids, ...payload.theme_ids];
    if (categoryIds.length) {
      const insertPayload = categoryIds.map((category_id) => ({ playlist_id: initialData.id, category_id }));
      const { error: insertError } = await supabase.from("playlist_categories").insert(insertPayload);
      if (insertError) {
        throw new Error(insertError.message || "Failed to apply playlist categories.");
      }
    }

    toast.success("Playlist updated");
    router.push(`/playlist/${initialData.id}`);
  };

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gradient-to-b from-[#050109] via-[#0d0519] to-[#030106] text-white">
        <Loader2 className="h-8 w-8 animate-spin" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gradient-to-b from-[#050109] via-[#0d0519] to-[#030106] px-6 text-center text-white">
        <div className="space-y-4">
          <p className="text-lg font-semibold">{error}</p>
          <button
            onClick={() => router.push("/library")}
            className="inline-flex items-center justify-center rounded-full bg-yellow-400 px-6 py-3 text-black font-semibold shadow-lg shadow-yellow-500/40"
          >
            Return to Library
          </button>
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
        <PlaylistForm mode="edit" userId={user.id} initialData={initialData} onSubmit={handleUpdate} />
      </div>
    </div>
  );
}
