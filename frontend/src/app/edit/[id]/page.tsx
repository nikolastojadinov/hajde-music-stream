import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@supabase/supabase-js";
import PlaylistForm, { type PlaylistFormInitialData, type PlaylistFormSubmitPayload } from "../../../components/playlist/PlaylistForm";
import { requireUser } from "../../../lib/supabase/auth";
import { updatePlaylistWithCategories, type PlaylistUpdatePayload } from "../../../lib/supabase/playlists";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl) {
  throw new Error("NEXT_PUBLIC_SUPABASE_URL must be defined");
}

if (!serviceRoleKey) {
  throw new Error("SUPABASE_SERVICE_ROLE_KEY or NEXT_PUBLIC_SUPABASE_SERVICE_ROLE_KEY must be defined");
}

const adminClient = createClient(supabaseUrl, serviceRoleKey, {
  auth: {
    persistSession: false,
  },
});

type PlaylistRow = {
  id: string;
  title: string;
  description: string | null;
  cover_url: string | null;
  owner_id: string;
  region: number | string | null;
  era: number | string | null;
};

type PlaylistCategoryRow = {
  category_id: number | string;
  categories: {
    group_type: string | null;
  } | null;
};

const normalizeNumeric = (value: unknown): number | null => {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string" && value.trim().length > 0) {
    const parsed = Number(value);
    return Number.isNaN(parsed) ? null : parsed;
  }
  return null;
};

const loadPlaylistForEdit = async (playlistId: string, userId: string): Promise<PlaylistFormInitialData> => {
  const { data, error } = await adminClient
    .from("playlists")
    .select("id,title,description,cover_url,owner_id,region,era")
    .eq("id", playlistId)
    .maybeSingle();

  const playlist = data as PlaylistRow | null;

  if (error || !playlist) {
    throw new Error(error?.message || "Playlist not found.");
  }

  if (playlist.owner_id !== userId) {
    throw new Error("You do not have permission to edit this playlist.");
  }

  const { data: links, error: linksError } = await adminClient
    .from("playlist_categories")
    .select("category_id,categories!inner(group_type)")
    .eq("playlist_id", playlistId);

  if (linksError) {
    throw new Error(linksError.message || "Failed to load playlist categories.");
  }

  const genreIds: number[] = [];
  const themeIds: number[] = [];

  const categoryLinks = (links ?? []) as PlaylistCategoryRow[];

  categoryLinks.forEach((link) => {
    const categoryId = normalizeNumeric(link.category_id);
    if (!categoryId) {
      return;
    }
    const group = link.categories?.group_type ?? "";
    if (group === "genre") {
      genreIds.push(categoryId);
    }
    if (group === "theme") {
      themeIds.push(categoryId);
    }
  });

  return {
    id: playlist.id,
    title: playlist.title,
    description: playlist.description,
    cover_url: playlist.cover_url,
    region_id: normalizeNumeric(playlist.region),
    era_id: normalizeNumeric(playlist.era),
    genre_ids: Array.from(new Set(genreIds)),
    theme_ids: Array.from(new Set(themeIds)),
  };
};

type EditPlaylistPageProps = {
  params: {
    id?: string;
  };
};

export default async function EditPlaylistPage({ params }: EditPlaylistPageProps) {
  const playlistId = params?.id;
  if (!playlistId) {
    return <ErrorView message="Missing playlist id." />;
  }

  const resolvedPlaylistId = playlistId;

  const user = await requireUser(`/login?redirect=/edit/${resolvedPlaylistId}`);

  let initialData: PlaylistFormInitialData | null = null;
  let loadError: string | null = null;

  try {
    initialData = await loadPlaylistForEdit(resolvedPlaylistId, user.id);
  } catch (error) {
    loadError = error instanceof Error ? error.message : "Failed to load playlist.";
  }

  if (loadError || !initialData) {
    return <ErrorView message={loadError ?? "Playlist not found."} />;
  }

  async function updatePlaylist(payload: PlaylistFormSubmitPayload): Promise<void> {
    "use server";

    if (!payload.category_groups || payload.category_groups.all.length === 0) {
      throw new Error("Please select at least one category.");
    }

    const uniqueCategoryIds = Array.from(new Set(payload.category_groups.all));
    const playlistPayload: PlaylistUpdatePayload = {
      title: payload.title,
      description: payload.description,
      cover_url: payload.cover_url,
      region: payload.region_id,
      era: payload.era_id,
    };

    await updatePlaylistWithCategories(resolvedPlaylistId, playlistPayload, uniqueCategoryIds);
    redirect(`/playlist/${resolvedPlaylistId}`);
  }

  return (
    <div className="min-h-screen bg-gradient-to-b from-[#050109] via-[#0d0519] to-[#030106] px-6 py-16 text-white">
      <div className="mx-auto w-full max-w-5xl space-y-8">
        <div>
          <p className="text-sm uppercase tracking-[0.3em] text-white/50">PurpleMusic Studio</p>
          <h1 className="text-4xl font-bold">Edit playlist</h1>
          <p className="mt-2 text-white/70">Adjust the metadata, switch the vibe, or retag your playlist for discovery.</p>
        </div>
        <PlaylistForm mode="edit" userId={user.id} initialData={initialData} onSubmit={updatePlaylist} />
      </div>
    </div>
  );
}

type ErrorViewProps = {
  message: string;
};

function ErrorView({ message }: ErrorViewProps) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-b from-[#050109] via-[#0d0519] to-[#030106] px-6 text-center text-white">
      <div className="space-y-4">
        <p className="text-lg font-semibold">{message}</p>
        <Link
          href="/library"
          className="inline-flex items-center justify-center rounded-full bg-yellow-400 px-6 py-3 font-semibold text-black shadow-lg shadow-yellow-500/40"
        >
          Return to Library
        </Link>
      </div>
    </div>
  );
}
