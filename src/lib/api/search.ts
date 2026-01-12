import { withBackendOrigin } from "@/lib/backendUrl";

export type SearchSuggestItem = {
  type: "artist" | "track" | "album" | "playlist";
  id: string;
  name: string;
  imageUrl?: string;
  subtitle?: string;
};

export type SearchSuggestResponse = {
  q: string;
  source: string;
  suggestions: SearchSuggestItem[];
};

export type SearchResultItem = {
  id: string;
  title: string;
  imageUrl: string | null;
  subtitle?: string | null;
  endpointType: "watch" | "browse";
  endpointPayload: string;
   kind: "song" | "artist" | "album" | "playlist";
   pageType?: string;
};

export type SearchSections = {
  songs: SearchResultItem[];
  artists: SearchResultItem[];
  albums: SearchResultItem[];
  playlists: SearchResultItem[];
};

export type SearchResolveResponse = {
  q: string;
  source: string;
  featured: SearchResultItem | null;
  sections: SearchSections;
};

async function readJson(response: Response): Promise<any> {
  const text = await response.text();
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    throw new Error("Invalid JSON from server");
  }
}

export async function searchSuggest(q: string, options?: { signal?: AbortSignal }): Promise<SearchSuggestResponse> {
  const trimmed = q.trim();
  if (trimmed.length < 2) {
    return { q: trimmed, source: "client", suggestions: [] };
  }
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

  const json = await readJson(response);
  return json as SearchSuggestResponse;
}

export async function searchResolve(payload: { q: string }, options?: { signal?: AbortSignal }): Promise<SearchResolveResponse> {
  const url = new URL(withBackendOrigin("/api/search/results"));
  url.searchParams.set("q", payload.q.trim());

  const response = await fetch(url.toString(), {
    method: "GET",
    credentials: "include",
    signal: options?.signal,
    headers: { Accept: "application/json" },
  });

  if (!response.ok) {
    throw new Error("Search resolve failed");
  }

  const json = await readJson(response);
  return json as SearchResolveResponse;
}
