import { createClient, type PostgrestError } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl) {
  throw new Error("NEXT_PUBLIC_SUPABASE_URL must be defined");
}

if (!serviceRoleKey) {
  throw new Error("SUPABASE_SERVICE_ROLE_KEY or NEXT_PUBLIC_SUPABASE_SERVICE_ROLE_KEY must be defined for server operations");
}

const supabase = createClient(supabaseUrl, serviceRoleKey, {
  auth: {
    persistSession: false,
  },
});

type BasePlaylistPayload = {
  title: string;
  description: string | null;
  cover_url: string | null;
  region: number;
  era: number;
};

export type PlaylistInsertPayload = BasePlaylistPayload & {
  owner_id: string;
};

export type PlaylistUpdatePayload = BasePlaylistPayload;

type CategoryRow = {
  playlist_id: string;
  category_id: number;
};

const buildCategoryRows = (playlistId: string, categoryIds: number[]): CategoryRow[] =>
  categoryIds.map((categoryId) => ({
    playlist_id: playlistId,
    category_id: categoryId,
  }));

const handlePostgrestError = (error: PostgrestError | null, fallbackMessage: string): never => {
  if (error) {
    throw new Error(error.message || fallbackMessage);
  }
  throw new Error(fallbackMessage);
};

export const insertPlaylistWithCategories = async (
  playlistPayload: PlaylistInsertPayload,
  categoryIds: number[],
): Promise<string> => {
  const { data, error } = await supabase
    .from("playlists")
    .insert(playlistPayload)
    .select("id")
    .single();

  if (error || !data) {
    handlePostgrestError(error, "Failed to create playlist.");
  }

  const playlistId = data.id;
  if (categoryIds.length > 0) {
    const rows = buildCategoryRows(playlistId, categoryIds);
    const { error: linkError } = await supabase
      .from("playlist_categories")
      .upsert(rows, { onConflict: "playlist_id,category_id" });

    if (linkError) {
      handlePostgrestError(linkError, "Failed to link playlist categories.");
    }
  }

  return playlistId;
};

export const updatePlaylistWithCategories = async (
  playlistId: string,
  playlistPayload: PlaylistUpdatePayload,
  categoryIds: number[],
): Promise<void> => {
  const { error: updateError } = await supabase.from("playlists").update(playlistPayload).eq("id", playlistId);
  if (updateError) {
    handlePostgrestError(updateError, "Failed to update playlist metadata.");
  }

  const { error: deleteError } = await supabase
    .from("playlist_categories")
    .delete()
    .eq("playlist_id", playlistId);
  if (deleteError) {
    handlePostgrestError(deleteError, "Failed to reset playlist categories.");
  }

  if (categoryIds.length === 0) {
    return;
  }

  const rows = buildCategoryRows(playlistId, categoryIds);
  const { error: insertError } = await supabase
    .from("playlist_categories")
    .insert(rows, { returning: "minimal" });

  if (insertError) {
    handlePostgrestError(insertError, "Failed to apply playlist categories.");
  }
};
