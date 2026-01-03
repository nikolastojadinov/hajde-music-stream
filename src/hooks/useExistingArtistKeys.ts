import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { deriveArtistKey } from "@/lib/artistKey";

export function useExistingArtistKeys(artistNames: Array<string | null | undefined>) {
  const artistKeys = useMemo(() => {
    const unique = new Set<string>();
    for (const name of artistNames) {
      const key = deriveArtistKey(name || "");
      if (key) unique.add(key);
    }
    return Array.from(unique);
  }, [artistNames]);

  const query = useQuery({
    queryKey: ["artist-keys", artistKeys],
    enabled: artistKeys.length > 0,
    staleTime: 5 * 60 * 1000,
    gcTime: 10 * 60 * 1000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("artists")
        .select("artist_key")
        .in("artist_key", artistKeys);

      if (error) throw error;

      const present = new Set<string>();
      for (const row of data || []) {
        const key = typeof (row as any)?.artist_key === "string" ? (row as any).artist_key.trim() : "";
        if (key) present.add(key);
      }

      return present;
    },
  });

  return {
    ...query,
    existingKeys: query.data ?? new Set<string>(),
  };
}
