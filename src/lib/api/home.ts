import { withBackendOrigin } from "@/lib/backendUrl";
import { getBackendHeaders } from "@/contexts/PiContext";

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
    track_count?: number | null;
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

export type MostPopularSnapshotItem = {
  type: "playlist";
  id: string;
  external_id: string | null;
  title: string;
  subtitle: string;
  imageUrl: string | null;
  metrics: {
    views_total: number;
    views_7d: number;
    track_count?: number | null;
  };
};

export type MostPopularSnapshot = {
  section: "most_popular";
  generated_at: string;
  refresh_policy: {
    type: "interval";
    interval: "weekly";
    preferred_window: "02:00-04:00 UTC";
  };
  items: MostPopularSnapshotItem[];
};

export type NewReleasesSnapshotItem = {
  type: "playlist";
  id: string;
  external_id: string | null;
  title: string;
  subtitle: string;
  imageUrl: string | null;
  metrics: {
    views_total: number;
    views_7d: number;
    release_at: string | null;
    track_count?: number | null;
  };
};

export type NewReleasesSnapshot = {
  section: "new_releases";
  generated_at: string;
  refresh_policy: {
    type: "interval";
    interval: "weekly";
    preferred_window: "02:00-04:00 UTC";
  };
  items: NewReleasesSnapshotItem[];
};

export async function fetchTrendingNowSnapshot(options?: { signal?: AbortSignal }): Promise<TrendingSnapshot> {
  const endpoint = withBackendOrigin("/api/home/sections/trending-now");
  const res = await fetch(endpoint, {
    method: "GET",
    credentials: "include",
    signal: options?.signal,
    headers: {
      Accept: "application/json",
      ...getBackendHeaders(),
    },
  });

  if (!res.ok) {
    throw new Error(`Failed to load TrendingNow snapshot: ${res.status}`);
  }

  return (await res.json()) as TrendingSnapshot;
}

export async function fetchMostPopularSnapshot(options?: { signal?: AbortSignal }): Promise<MostPopularSnapshot> {
  const endpoint = withBackendOrigin("/api/home/sections/most-popular");
  const res = await fetch(endpoint, {
    method: "GET",
    credentials: "include",
    signal: options?.signal,
    headers: {
      Accept: "application/json",
      ...getBackendHeaders(),
    },
  });

  if (!res.ok) {
    throw new Error(`Failed to load MostPopular snapshot: ${res.status}`);
  }

  return (await res.json()) as MostPopularSnapshot;
}

export async function fetchNewReleasesSnapshot(options?: { signal?: AbortSignal }): Promise<NewReleasesSnapshot> {
  const endpoint = withBackendOrigin("/api/home/sections/new-releases");
  const res = await fetch(endpoint, {
    method: "GET",
    credentials: "include",
    signal: options?.signal,
    headers: {
      Accept: "application/json",
      ...getBackendHeaders(),
    },
  });

  if (!res.ok) {
    throw new Error(`Failed to load NewReleases snapshot: ${res.status}`);
  }

  return (await res.json()) as NewReleasesSnapshot;
}
