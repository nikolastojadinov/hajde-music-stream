import { withBackendOrigin } from "@/lib/backendUrl";

export type SearchSuggestResponse = {
  q: string;
  source: "spotify_suggest";
  suggestions: string[];
  // Optional enrichment (DB-only) keyed by artist_key.
  artist_media?: Record<
    string,
    {
      name: string;
      youtube_channel_id: string | null;
      thumbnail_url: string | null;
      banner_url: string | null;
    }
  >;
};

export type SearchResolveMode = "track" | "artist" | "album" | "generic";

export type SearchResolveRequest = {
  q: string;
  mode: SearchResolveMode;
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
