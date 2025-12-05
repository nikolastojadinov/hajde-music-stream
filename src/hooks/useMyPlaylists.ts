import { useQuery } from "@tanstack/react-query";
import { usePi } from "@/contexts/PiContext";
import { externalSupabase } from "@/lib/externalSupabase";
import { fetchOwnerProfile } from "@/lib/ownerProfile";

export type UserPlaylist = {
  id: string;
  title: string;
  description?: string | null;
  cover_url?: string | null;
  is_public?: boolean | null;
  owner_id?: string | null;
};

type UseMyPlaylistsOptions = {
  enabled?: boolean;
};

export const useMyPlaylists = (options?: UseMyPlaylistsOptions) => {
  const { user } = usePi();
  const enabled = Boolean(user?.uid) && (options?.enabled ?? true);

  return useQuery<UserPlaylist[]>({
    queryKey: ["my-playlists", user?.uid],
    enabled,
    queryFn: async () => {
      const profile = await fetchOwnerProfile();
      if (!profile?.owner_id) {
        throw new Error("missing_owner_profile");
      }

      const { data, error } = await externalSupabase
        .from("playlists")
        .select("id,title,description,cover_url,is_public,owner_id,created_at")
        .eq("owner_id", profile.owner_id)
        .order("created_at", { ascending: false });

      if (error) {
        console.error("[useMyPlaylists] Failed to load playlists", error);
        throw new Error(error.message || "Unable to load playlists");
      }

      return (data || []) as UserPlaylist[];
    },
    staleTime: 60_000,
    gcTime: 5 * 60_000,
    refetchOnWindowFocus: false,
  });
};
