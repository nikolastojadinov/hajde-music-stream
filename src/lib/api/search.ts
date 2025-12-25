import { fetchWithPiAuth } from "@/lib/fetcher";
import { withBackendOrigin } from "@/lib/backendUrl";

export type SearchSuggestResponse = {
  q: string;
  source: "spotify_suggest" | "local_fallback";
  suggestions: Array<{
    type: "artist" | "track" | "playlist" | "album";
    id: string;
    name: string;
    imageUrl?: string;
    subtitle?: string;
    artists?: string[];
  }>;
};

export type SearchResolveMode = "track" | "artist" | "album" | "generic";

export type SearchResolveRequest = {
  q: string;
  mode: SearchResolveMode;
  // When true, server will run fallback ingest synchronously (if needed)
  // and return refreshed local results.
  sync?: boolean;
};

export type SearchSuggestLocalTrack = {
  id: string;
  title: string;
  artist: string;
  externalId: string | null;
  coverUrl: string | null;
  duration: number | null;
};

export type SearchSuggestLocalPlaylist = {
  id: string;
  title: string;
  externalId: string | null;
  coverUrl: string | null;
};

export type SearchResolveLocal = {
  tracks: SearchSuggestLocalTrack[];
  playlists: SearchSuggestLocalPlaylist[];
};

export type SearchResolveResponse = {
  q: string;
  // Some backend responses include top-level lists in addition to the `local` envelope.
  // Prefer these if present.
  tracks?: SearchSuggestLocalTrack[];
  local: SearchResolveLocal;
  decision: "local_only" | "youtube_fallback";

  // Wiring fields for "Search triggers artist ingestion" pipeline.
  artist_ingested: boolean;
  artist_name: string | null;

  // Whether background ingest/backfill was started for this resolve.
  ingest_started?: boolean;

  // Optional enriched artist media (from Supabase artists table)
  artist?: {
    name: string;
    youtube_channel_id: string | null;
    thumbnail_url: string | null;
    banner_url: string | null;
  } | null;
};

export type RecentSearchEntityType = "artist" | "song" | "playlist" | "album" | "generic";

export type RecentSearchItem = {
  id: number;
  query: string;
  entity_type: RecentSearchEntityType;
  entity_id: string | null;
  created_at: string;
  last_used_at: string;
  use_count: number;
};

async function readJsonOrThrow(response: Response): Promise<any> {
  const text = await response.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    throw new Error("Invalid JSON from server");
  }
}

export async function searchSuggest(q: string, options?: { signal?: AbortSignal }): Promise<SearchSuggestResponse> {
  const trimmed = q.trim();
  const url = new URL(withBackendOrigin("/api/search/suggest"));
  url.searchParams.set("q", trimmed);

  const response = await fetch(url.toString(), {
    method: "GET",
    credentials: "include",
    signal: options?.signal,
    headers: { Accept: "application/json" },
  });

  if (!response.ok) {
    throw new Error("Search suggest failed");
  }

  const json = await readJsonOrThrow(response);
  return json as SearchSuggestResponse;
}

export async function searchResolve(
  payload: SearchResolveRequest,
  options?: { signal?: AbortSignal }
): Promise<SearchResolveResponse> {
  const response = await fetch(withBackendOrigin("/api/search/resolve"), {
    method: "POST",
    credentials: "include",
    signal: options?.signal,
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    throw new Error("Search resolve failed");
  }

  const json = await readJsonOrThrow(response);
  return json as SearchResolveResponse;
}

export async function getRecentSearches(): Promise<RecentSearchItem[]> {
  const response = await fetchWithPiAuth("/api/search/recent", {
    method: "GET",
    headers: { Accept: "application/json" },
  });

  if (!response.ok) {
    throw new Error("Failed to load recent searches");
  }

  const json = await readJsonOrThrow(response);
  return (json?.items ?? []) as RecentSearchItem[];
}

export async function upsertRecentSearch(payload: {
  query: string;
  entity_type?: RecentSearchEntityType;
  entity_id?: string | null;
}): Promise<RecentSearchItem[]> {
  const response = await fetchWithPiAuth("/api/search/recent", {
    method: "POST",
    headers: { Accept: "application/json" },
    body: JSON.stringify({
      query: payload.query,
      entity_type: payload.entity_type ?? "generic",
      entity_id: payload.entity_id ?? null,
    }),
  });

  if (!response.ok) {
    throw new Error("Failed to save recent search");
  }

  const json = await readJsonOrThrow(response);
  return (json?.items ?? []) as RecentSearchItem[];
}

export async function deleteRecentSearch(id: number): Promise<RecentSearchItem[]> {
  const response = await fetchWithPiAuth(`/api/search/recent/${id}`, {
    method: "DELETE",
    headers: { Accept: "application/json" },
  });

  if (!response.ok) {
    throw new Error("Failed to delete recent search");
  }

  const json = await readJsonOrThrow(response);
  return (json?.items ?? []) as RecentSearchItem[];
}
