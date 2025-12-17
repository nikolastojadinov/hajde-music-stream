import { withBackendOrigin } from "@/lib/backendUrl";

export type SearchSuggestResponse = {
  q: string;
  source: "youtube_suggest";
  suggestions: string[];
};

export type SearchResolveMode = "track" | "artist" | "album" | "generic";

export type SearchResolveRequest = {
  q: string;
  mode: SearchResolveMode;
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
