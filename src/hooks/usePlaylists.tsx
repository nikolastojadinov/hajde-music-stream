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
        .select("id, title, description, category, cover_url, created_at")
        .order("created_at", { ascending: false });

      if (category) {
        query = query.eq("category", category);
      }

      const { data, error } = await query;

      if (error) throw error;
      
      // Map cover_url to image_url for compatibility
      const playlists = (data || []).map(p => ({
        ...p,
        image_url: p.cover_url || null
      }));
      
      return playlists as Playlist[];
    },
  });
};
