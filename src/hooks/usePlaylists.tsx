import { useQuery } from "@tanstack/react-query";
import { externalSupabase } from "@/lib/externalSupabase";

export interface Playlist {
  id: string;
  title: string;
  description: string | null;
  category: string | null;
  image_url: string | null;
  created_at: string;
}

export const usePlaylists = (category?: string) => {
  return useQuery({
    queryKey: ["playlists", category],
    queryFn: async () => {
      let query = externalSupabase
        .from("playlists")
        .select("*")
        .order("created_at", { ascending: false });

      if (category) {
        query = query.eq("category", category);
      }

      const { data, error } = await query;

      if (error) throw error;
      return data as Playlist[];
    },
  });
};
