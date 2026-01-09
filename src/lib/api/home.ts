import { withBackendOrigin } from "@/lib/backendUrl";

export type TrendingSnapshotItem = {
  type: "playlist";
  id: string;
  external_id: string | null;
  title: string;
  subtitle: string;
  imageUrl: string | null;
  metrics: {
    views_7d: number;
    trend_score: number;
  };
};

export type TrendingSnapshot = {
  section: "trending_now";
  generated_at: string;
  refresh_policy: {
    type: "interval";
    interval: "weekly";
    preferred_window: "02:00-04:00 UTC";
  };
  items: TrendingSnapshotItem[];
};

export async function fetchTrendingNowSnapshot(options?: { signal?: AbortSignal }): Promise<TrendingSnapshot> {
  const endpoint = withBackendOrigin("/api/home/sections/trending-now");
  const res = await fetch(endpoint, {
    method: "GET",
    credentials: "include",
    signal: options?.signal,
    headers: {
      "Accept": "application/json",
    },
  });

  if (!res.ok) {
    throw new Error(`Failed to load TrendingNow snapshot: ${res.status}`);
  }

  return (await res.json()) as TrendingSnapshot;
}
