import { redirect } from "next/navigation";
import PlaylistForm, { type PlaylistFormSubmitPayload } from "../../components/playlist/PlaylistForm";
import { requireUser } from "../../lib/supabase/auth";
import { insertPlaylistWithCategories, type PlaylistInsertPayload } from "../../lib/supabase/playlists";

export default async function CreatePlaylistPage() {
  const user = await requireUser("/login?redirect=/create");

  const ownerId = user.id;

  async function createPlaylist(payload: PlaylistFormSubmitPayload): Promise<void> {
    "use server";

    if (!payload.category_groups || payload.category_groups.all.length === 0) {
      throw new Error("Please select at least one category.");
    }

    const uniqueCategoryIds = Array.from(new Set(payload.category_groups.all));
    const playlistPayload: PlaylistInsertPayload = {
      title: payload.title,
      description: payload.description,
      cover_url: payload.cover_url,
      owner_id: ownerId,
      region: payload.region_id,
      era: payload.era_id,
    };

    const playlistId = await insertPlaylistWithCategories(playlistPayload, uniqueCategoryIds);
    redirect(`/playlist/${playlistId}`);
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
        <PlaylistForm mode="create" userId={ownerId} onSubmit={createPlaylist} />
      </div>
    </div>
  );
}
