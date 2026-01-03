import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { withBackendOrigin } from "@/lib/backendUrl";
import { dedupeRequest } from "@/lib/requestDeduper";

export type PlaylistStats = {
  likes: number;
  views: number;
};

export type PlaylistStatsMap = Record<string, PlaylistStats>;

const STATS_CACHE_MS = 4000;

async function fetchStatsForIds(ids: string[]): Promise<PlaylistStatsMap> {
  const uniqueIds = Array.from(new Set(ids.filter(Boolean)));
  if (uniqueIds.length === 0) return {};

  const entries = await Promise.all(
    uniqueIds.map(async (id) => {
      const url = withBackendOrigin(`/api/playlists/${id}/public-stats`);
      try {
        const payload = await dedupeRequest<PlaylistStats>(
          `GET:${url}`,
          async () => {
            const res = await fetch(url, { credentials: "include" });

            if (res.status === 401) {
              return { likes: 0, views: 0 };
            }

            if (!res.ok) {
              throw new Error(`Failed to load playlist stats (${res.status})`);
            }

            const json = await res.json();
            return {
              likes: Number(json?.likes ?? 0) || 0,
              views: Number(json?.views ?? 0) || 0,
            };
          },
          { cache: true, ttlMs: STATS_CACHE_MS }
        );

        return [id, payload] as const;
      } catch (err) {
        console.warn("[usePlaylistPublicStats] stats fetch failed", { id, err });
        return null;
      }
    })
  );

  return entries.reduce<PlaylistStatsMap>((acc, entry) => {
    if (!entry) return acc;
    const [id, stats] = entry;
    acc[id] = stats;
    return acc;
  }, {});
}

export function usePlaylistPublicStats(ids: string[]) {
  const stableIds = useMemo(() => Array.from(new Set(ids.filter(Boolean))).sort(), [ids]);

  return useQuery<PlaylistStatsMap>({
    queryKey: ["playlist-public-stats", stableIds],
    queryFn: () => fetchStatsForIds(stableIds),
    enabled: stableIds.length > 0,
    staleTime: STATS_CACHE_MS,
    gcTime: 2 * STATS_CACHE_MS,
    refetchOnWindowFocus: false,
  });
}
