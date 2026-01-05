import { withBackendOrigin } from "@/lib/backendUrl";

export type SearchSuggestItem = {
  type: "artist" | "track" | "album";
  id: string;
  name: string;
  imageUrl?: string;
  subtitle?: string;
  artists?: string[];
};

export type SearchSuggestResponse = {
  q: string;
  source: "youtube_live";
  suggestions: SearchSuggestItem[];
};

export type SearchResolveResponse = {
  q: string;
  source: "youtube_live";
  tracks: Array<{ id: string; title: string; artist: string; youtubeId: string; imageUrl?: string }>;
  artists: Array<{ id: string; name: string; imageUrl?: string }>;
  albums: Array<{ id: string; title: string; channelId?: string | null; channelTitle?: string | null; imageUrl?: string }>;
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

export async function searchResolve(payload: { q: string }, options?: { signal?: AbortSignal }): Promise<SearchResolveResponse> {
  const url = new URL(withBackendOrigin("/api/search/results"));
  url.searchParams.set("q", payload.q.trim());

  const response = await fetch(url.toString(), {
    method: "GET",
    credentials: "include",
    signal: options?.signal,
    headers: {
      Accept: "application/json",
    },
  });

  if (!response.ok) {
    throw new Error("Search resolve failed");
  }

  const json = await readJsonOrThrow(response);
  return json as SearchResolveResponse;
}
