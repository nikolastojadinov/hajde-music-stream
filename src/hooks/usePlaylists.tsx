import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export interface Playlist {
  id: string;
  title: string;
  description: string | null;
  category: string | null;
  cover_url: string | null;
  created_at: string;
  like_count?: number | null;
  view_count?: number | null;
  public_like_count?: number | null;
  public_view_count?: number | null;
}

export const usePlaylists = (category?: string) => {
  return useQuery({
    queryKey: ["playlists", category],
    queryFn: async () => {
      let query = supabase
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
