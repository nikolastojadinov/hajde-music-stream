import { withBackendOrigin } from "@/lib/backendUrl";

export type SearchSectionKind =
  | "top_results"
  | "songs"
  | "videos"
  | "artists"
  | "albums"
  | "playlists"
  | "community_playlists"
  | "featured_playlists"
  | "profiles"
  | string;

export type SearchTrackItem = {
  id: string;
  title: string;
  artist?: string;
  artists?: string[];
  youtubeId: string;
  imageUrl?: string;
  album?: string | null;
  durationMs?: number | null;
};

export type SearchArtistItem = {
  id: string;
  name: string;
  imageUrl?: string;
  subtitle?: string;
};

export type SearchAlbumItem = {
  id: string;
  title: string;
  imageUrl?: string;
  channelId?: string | null;
  channelTitle?: string | null;
  subtitle?: string | null;
};

export type SearchPlaylistItem = {
  id: string;
  title: string;
  imageUrl?: string;
  subtitle?: string | null;
};

export type SearchSection = {
  kind: SearchSectionKind;
  title?: string | null;
  items: Array<SearchTrackItem | SearchArtistItem | SearchAlbumItem | SearchPlaylistItem>;
  continuation?: unknown;
};

export type SearchResolveResponse = {
  q: string;
  source: string;
  sections: SearchSection[];
  refinements?: string[];
};

export type SearchSuggestItem = {
  type: "artist" | "track" | "album" | "playlist";
  id: string;
  name: string;
  imageUrl?: string;
  subtitle?: string;
  artists?: string[];
};

export type SearchSuggestResponse = {
  q: string;
  source: string;
  suggestions: SearchSuggestItem[];
};

async function readJsonOrThrow(response: Response): Promise<any> {
  const text = await response.text();
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    throw new Error("Invalid JSON from server");
  }
}

function coerceSectionItems(items: any): any[] {
  return Array.isArray(items) ? items : [];
}

function normalizeToSections(json: any): SearchSection[] {
  if (Array.isArray(json?.sections)) {
    return json.sections.map((s: any) => ({
      kind: typeof s?.kind === "string" ? s.kind : "unknown",
      title: s?.title ?? null,
      items: coerceSectionItems(s?.items),
      continuation: s?.continuation,
    }));
  }

  const sections: SearchSection[] = [];

  if (Array.isArray(json?.tracks)) {
    sections.push({
      kind: "songs",
      title: "Songs",
      items: coerceSectionItems(json.tracks),
    });
  }

  if (Array.isArray(json?.artists)) {
    sections.push({
      kind: "artists",
      title: "Artists",
      items: coerceSectionItems(json.artists),
    });
  }

  if (Array.isArray(json?.albums)) {
    sections.push({
      kind: "albums",
      title: "Albums",
      items: coerceSectionItems(json.albums),
    });
  }

  return sections;
}

function normalizeResolveResponse(json: any): SearchResolveResponse {
  return {
    q: typeof json?.q === "string" ? json.q : "",
    source: typeof json?.source === "string" ? json.source : "unknown",
    sections: normalizeToSections(json),
    refinements: Array.isArray(json?.refinements) ? json.refinements.map(String) : undefined,
  };
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
    headers: { Accept: "application/json" },
  });

  if (!response.ok) {
    throw new Error("Search resolve failed");
  }

  const json = await readJsonOrThrow(response);
  return normalizeResolveResponse(json);
}
