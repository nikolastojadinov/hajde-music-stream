import { withBackendOrigin } from "@/lib/backendUrl";

export type SearchResultKind = "song" | "artist" | "album" | "playlist";

const OFFICIAL_ACDC_ID = "UCVm4YdI3hobkwsHTTOMVJKg";

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

const normalizeLoose = (value: string | null | undefined): string => normalizeString(value).toLowerCase().replace(/[^a-z0-9]+/g, "");

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

const isTributeLike = (value: string | null | undefined): boolean => {
  const lower = normalizeString(value).toLowerCase();
  if (!lower) return false;
  return lower.includes("tribute") || lower.includes("cover") || lower.includes("karaoke");
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

const isArtistBad = (artist: { id?: string | null; name?: string | null; pageType?: string | null }): boolean => {
  if (!artist) return false;
  const name = artist.name || "";
  return isProfileLike(artist.pageType) || isProfileLike(name) || isTributeLike(name);
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

const uniqBy = <T, K>(items: (T | null)[], key: (item: T) => K): T[] => {
  const seen = new Set<K>();
  const out: T[] = [];
  items.forEach((item) => {
    if (!item) return;
    const k = key(item);
    if (seen.has(k)) return;
    seen.add(k);
    out.push(item);
  });
  return out;
};

export function normalizeSearchSections(sections?: SearchSections | null, orderedItems?: SearchResultItem[] | null): SearchSection[] {
  const payload = sections ?? DEFAULT_SECTIONS;
  const normalized: SearchSection[] = [];

  const ordered = Array.isArray(orderedItems) ? orderedItems : [];

  const songs = uniqBy(
    [...(payload.songs || []), ...ordered.filter((i) => i?.kind === "song")].map(toTrack),
    (t) => t.youtubeVideoId || t.id
  ) as SearchTrackItem[];
  if (songs.length > 0) normalized.push({ kind: "songs", title: "Songs", items: songs });

  const artists = uniqBy(
    [...(payload.artists || []), ...ordered.filter((i) => i?.kind === "artist")]
      .map(toArtist)
      .filter((a) => a && (!isArtistBad(a) || normalizeString(a.id).toUpperCase() === OFFICIAL_ACDC_ID.toUpperCase())),
    (a) => a.id
  ) as SearchArtistItem[];
  if (artists.length > 0) normalized.push({ kind: "artists", title: "Artists", items: artists });

  const albums = uniqBy(
    [...(payload.albums || []), ...ordered.filter((i) => i?.kind === "album")].map(toAlbum),
    (a) => a.id
  ) as SearchAlbumItem[];
  if (albums.length > 0) normalized.push({ kind: "albums", title: "Albums", items: albums });

  const playlists = uniqBy(
    [...(payload.playlists || []), ...ordered.filter((i) => i?.kind === "playlist")].map(toPlaylist),
    (p) => p.id
  ) as SearchPlaylistItem[];
  if (playlists.length > 0) normalized.push({ kind: "playlists", title: "Playlists", items: playlists });

  return normalized;
}

const isProfileLike = (value: string | null | undefined): boolean => {
  const lower = normalizeString(value).toLowerCase();
  if (!lower) return false;
  return lower.includes("profile") || lower.includes("podcast") || lower.includes("episode") || lower.includes("show");
};

const looseTokens = (value: string | null | undefined): string[] =>
  normalizeString(value)
    .toLowerCase()
    .split(/[^a-z0-9]+/g)
    .filter(Boolean);

const isValidTopCandidate = (item: SearchResultItem | null | undefined, allowProfile: boolean): item is SearchResultItem => {
  if (!item) return false;
  if (!allowProfile && (isProfileLike(item.subtitle) || isProfileLike(item.pageType))) return false;
  return true;
};

export function pickTopResult(payload: SearchResolveResponse | null, query?: string | null): SearchResultItem | null {
  if (!payload) return null;

  const qLoose = normalizeLoose(query || payload.q || "");
  const qTokens = looseTokens(query || payload.q || "");

  const ordered: Array<SearchResultItem | null | undefined> = [
    payload.featured,
    ...(Array.isArray(payload.orderedItems) ? payload.orderedItems : []),
    ...(payload.sections?.artists ?? []),
    ...(payload.sections?.songs ?? []),
    ...(payload.sections?.albums ?? []),
    ...(payload.sections?.playlists ?? []),
  ];

  const officialCandidate = ordered.find(
    (c) => normalizeString(c?.endpointPayload || c?.id).toUpperCase() === OFFICIAL_ACDC_ID.toUpperCase()
  );
  if (officialCandidate && !isArtistBad({ id: officialCandidate.id, name: officialCandidate.title, pageType: officialCandidate.pageType })) {
    return officialCandidate as SearchResultItem;
  }

  const scoreCandidate = (item: SearchResultItem | null | undefined, index: number): number => {
    if (!item) return -1;

    const titleLoose = normalizeLoose(item.title);
    const subtitleLoose = normalizeLoose(item.subtitle || "");
    const exactLoose = qLoose && (titleLoose === qLoose || subtitleLoose === qLoose);

    // Avoid profile-like cards unless they exactly match the query
    const profileish = isProfileLike(item.subtitle) || isProfileLike(item.pageType);
    if (profileish && !exactLoose) return -1;

    let score = 0;

    if (exactLoose) score += 120;

    const itemTokens = looseTokens(`${item.title} ${item.subtitle ?? ""}`);
    if (qTokens.length > 0) {
      const hits = qTokens.filter((tok) => itemTokens.includes(tok)).length;
      if (hits === qTokens.length) score += 80;
      else if (hits > 0) score += 50 + hits * 5;
    }

    if (item.kind === "artist") score += 30;
    else if (item.kind === "album" || item.kind === "playlist") score += 10;
    else score += 5;

    if (normalizeString(item.pageType).includes("ARTIST")) score += 5;
    if (item.isOfficial) score += 3;

    // Preserve earlier ordering when scores tie
    return score - index * 0.001;
  };

  let best: { item: SearchResultItem; score: number } | null = null;

  ordered.forEach((candidate, idx) => {
    if (isArtistBad({ id: candidate?.id, name: candidate?.title, pageType: candidate?.pageType })) return;
    const score = scoreCandidate(candidate, idx);
    if (score < 0) return;
    if (!best || score > best.score) {
      best = { item: candidate as SearchResultItem, score };
    }
  });

  if (best) return best.item;

  const fallback = ordered.find((item) => isValidTopCandidate(item, false));
  return fallback ?? null;
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
  const parsed = json as SearchSuggestResponse;

  const deduped: SearchSuggestItem[] = [];
  const seen = new Set<string>();
  for (const item of parsed?.suggestions ?? []) {
    if (item.type === "artist" && isArtistBad({ name: item.name, pageType: item.subtitle })) continue;
    const key = `${item.type}:${normalizeLoose(item.name) || item.id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(item);
  }

  // If official AC/DC appears, force it to the top
  const officialIdx = deduped.findIndex((s) => s.id === OFFICIAL_ACDC_ID);
  if (officialIdx > 0) {
    const [official] = deduped.splice(officialIdx, 1);
    deduped.unshift(official);
  }

  return { ...parsed, suggestions: deduped } as SearchSuggestResponse;
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
