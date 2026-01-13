import { withBackendOrigin } from "@/lib/backendUrl";

export type SearchResultKind = "song" | "artist" | "album" | "playlist";

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
  kind: SearchResultKind;
  pageType?: string;
  isOfficial?: boolean;
};

export type SearchSections = {
  songs: SearchResultItem[];
  artists: SearchResultItem[];
  albums: SearchResultItem[];
  playlists: SearchResultItem[];
};

export type SearchTrackItem = {
  id: string;
  youtubeVideoId: string;
  title: string;
  subtitle?: string | null;
  artists: string[];
  imageUrl?: string | null;
};

export type SearchArtistItem = {
  id: string;
  name: string;
  imageUrl?: string | null;
  pageType?: string;
  isOfficial?: boolean;
};

export type SearchAlbumItem = {
  id: string;
  title: string;
  artist?: string | null;
  channelTitle?: string | null;
  imageUrl?: string | null;
};

export type SearchPlaylistItem = {
  id: string;
  title: string;
  subtitle?: string | null;
  imageUrl?: string | null;
};

export type SearchSection =
  | { kind: "songs"; title?: string | null; items: SearchTrackItem[] }
  | { kind: "artists"; title?: string | null; items: SearchArtistItem[] }
  | { kind: "albums"; title?: string | null; items: SearchAlbumItem[] }
  | { kind: "playlists"; title?: string | null; items: SearchPlaylistItem[] };

export type SearchSelectionPayload = {
  type: "artist" | "song" | "video" | "album" | "playlist" | "episode";
  id: string;
  title?: string;
  subtitle?: string | null;
  imageUrl?: string | null;
};

export type SearchResolveResponse = {
  q: string;
  source: string;
  featured: SearchResultItem | null;
  orderedItems: SearchResultItem[];
  sections: SearchSections;
};

const DEFAULT_SECTIONS: SearchSections = { songs: [], artists: [], albums: [], playlists: [] };

const normalizeString = (value: unknown): string => (typeof value === "string" ? value.trim() : "");

const readJson = async (response: Response): Promise<any> => {
  const text = await response.text();
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    throw new Error("Invalid JSON from server");
  }
};

const splitArtists = (subtitle?: string | null): string[] => {
  if (!subtitle) return [];
  const tokens = subtitle.split(/[·,/|]/g).map((token) => token.trim()).filter(Boolean);
  return tokens.length > 0 ? tokens : [subtitle.trim()].filter(Boolean);
};

const toTrack = (item: SearchResultItem): SearchTrackItem | null => {
  const youtubeVideoId = normalizeString(item.endpointPayload);
  if (item.endpointType !== "watch" || youtubeVideoId.length === 0) return null;

  return {
    id: item.id || youtubeVideoId,
    youtubeVideoId,
    title: item.title || "Song",
    subtitle: item.subtitle ?? null,
    artists: splitArtists(item.subtitle),
    imageUrl: item.imageUrl ?? null,
  };
};

const toArtist = (item: SearchResultItem): SearchArtistItem | null => {
  const id = normalizeString(item.endpointPayload || item.id);
  const name = normalizeString(item.title || item.subtitle || id);
  if (!id || !name) return null;
  return {
    id,
    name,
    imageUrl: item.imageUrl ?? null,
    pageType: item.pageType,
    isOfficial: item.isOfficial,
  };
};

const toAlbum = (item: SearchResultItem): SearchAlbumItem | null => {
  const id = normalizeString(item.endpointPayload || item.id);
  const title = normalizeString(item.title || id);
  if (!id || !title) return null;
  return {
    id,
    title,
    artist: item.subtitle ?? null,
    channelTitle: item.subtitle ?? null,
    imageUrl: item.imageUrl ?? null,
  };
};

const toPlaylist = (item: SearchResultItem): SearchPlaylistItem | null => {
  const id = normalizeString(item.endpointPayload || item.id);
  const title = normalizeString(item.title || id);
  if (!id || !title) return null;
  return { id, title, subtitle: item.subtitle ?? null, imageUrl: item.imageUrl ?? null };
};

export function normalizeSearchSections(sections?: SearchSections | null): SearchSection[] {
  const payload = sections ?? DEFAULT_SECTIONS;
  const normalized: SearchSection[] = [];

  const songs = (payload.songs || []).map(toTrack).filter(Boolean) as SearchTrackItem[];
  if (songs.length > 0) normalized.push({ kind: "songs", title: "Songs", items: songs });

  const artists = (payload.artists || []).map(toArtist).filter(Boolean) as SearchArtistItem[];
  if (artists.length > 0) normalized.push({ kind: "artists", title: "Artists", items: artists });

  const albums = (payload.albums || []).map(toAlbum).filter(Boolean) as SearchAlbumItem[];
  if (albums.length > 0) normalized.push({ kind: "albums", title: "Albums", items: albums });

  const playlists = (payload.playlists || []).map(toPlaylist).filter(Boolean) as SearchPlaylistItem[];
  if (playlists.length > 0) normalized.push({ kind: "playlists", title: "Playlists", items: playlists });

  return normalized;
}

export function pickTopResult(payload: SearchResolveResponse | null): SearchResultItem | null {
  if (!payload) return null;
  if (payload.featured) return payload.featured;

  const firstOrdered = Array.isArray(payload.orderedItems) ? payload.orderedItems.find(Boolean) : null;
  if (firstOrdered) return firstOrdered;

  const fallbackSection = payload.sections?.songs?.[0]
    || payload.sections?.artists?.[0]
    || payload.sections?.albums?.[0]
    || payload.sections?.playlists?.[0];
  return fallbackSection ?? null;
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

export async function ingestSearchSelection(payload: SearchSelectionPayload): Promise<void> {
  const url = withBackendOrigin("/api/search/ingest");

  await fetch(url, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({
      type: payload.type,
      id: payload.id,
      title: payload.title,
      subtitle: payload.subtitle,
      imageUrl: payload.imageUrl,
    }),
  }).catch(() => {
    /* swallow ingest errors on client */
  });
}
