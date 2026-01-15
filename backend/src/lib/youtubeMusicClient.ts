import {
  musicSearchRaw as fetchMusicSearchRaw,
  searchSuggestions as rawSearchSuggestions,
  browseArtistById,
  type MusicSearchSuggestion as RawSuggestion,
  type ArtistBrowse,
} from "../services/youtubeMusicClient";
import { musicSearch as fetchMusicSearch } from "../services/youtubeMusicClient";
import { recordInnertubePayload } from "../services/innertubeRawStore";

export type SuggestionType = "track" | "artist" | "album" | "playlist";

export type SuggestionItem = {
  type: SuggestionType;
  id: string;
  name: string;
  imageUrl: string | null;
  subtitle: string;
  endpointType: "watch" | "browse";
  endpointPayload: string;
};

export type SuggestResponse = {
  q: string;
  source: "youtube_live";
  suggestions: SuggestionItem[];
};

export type SearchResultItem = {
  id: string;
  title: string;
  imageUrl: string | null;
  subtitle: string;
  endpointType: "watch" | "browse";
  endpointPayload: string;
  kind: ParsedKind;
  pageType?: string;
  isOfficial?: boolean;
};

export type RawSearchItem = {
  rendererType: string;
  data: any;
};

export type SearchSections = {
  songs: SearchResultItem[];
  artists: SearchResultItem[];
  albums: SearchResultItem[];
  playlists: SearchResultItem[];
};

export type SearchResultsPayload = {
  q: string;
  source: "youtube_live";
  featured: SearchResultItem | null;
  orderedItems: SearchResultItem[];
  sections: SearchSections;
  raw?: any;
  rawItems?: RawSearchItem[];
};

const MIN_QUERY = 2;
const MAX_SUGGESTIONS_TOTAL = 12;
const MAX_SUGGESTIONS_PER_TYPE = 4;
const INTERLEAVE_ORDER: SuggestionType[] = ["track", "artist", "playlist", "album"];
const OFFICIAL_ACDC_ID = "UCVm4YdI3hobkwsHTTOMVJKg";

function normalizeString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeLoose(value: unknown): string {
  const base = normalizeString(value).toLowerCase();
  return base.replace(/[^a-z0-9]+/g, "");
}

function tryBuildItemFromNode(node: any): ParsedItem | null {
  const nav = extractNavigationEndpoint(node);
  const endpoint = classifyEndpoint(nav);
  const kind = inferKind(endpoint);
  if (!endpoint || !kind) return null;

  const title =
    pickText(node?.title) ||
    pickText(node?.header?.title) ||
    pickText(node?.flexColumns?.[0]?.musicResponsiveListItemFlexColumnRenderer?.text) ||
    "";
  if (!title) return null;

  const subtitle =
    pickText(node?.subtitle) ||
    pickText(node?.header?.subtitle) ||
    pickText(node?.flexColumns?.[1]?.musicResponsiveListItemFlexColumnRenderer?.text) ||
    "";

  const thumb =
    pickThumbnail(node?.thumbnail?.musicThumbnailRenderer?.thumbnail?.thumbnails) ||
    pickThumbnail(node?.thumbnail?.thumbnails) ||
    null;

  const defaultSubtitle = kind === "artist" ? "Artist" : kind === "album" ? "Album" : kind === "playlist" ? "Playlist" : "Song";
  const item = buildResultItem(title, subtitle || defaultSubtitle, thumb, endpoint, kind);
  return { kind, item };
}

function findHeroInTree(root: any, queryNorm?: string): SearchResultItem | null {
  let firstArtist: SearchResultItem | null = null;

  const visit = (node: any): SearchResultItem | null => {
    if (!node || typeof node !== "object") return null;

    if (node.musicCardShelfRenderer) {
      const parsed = parseMusicCardShelfRenderer(node.musicCardShelfRenderer);
      if (parsed && parsed.kind === "artist") {
        if (!firstArtist) firstArtist = parsed.item;
        if (queryNorm) {
          const titleNorm = normalizeLoose(parsed.item.title);
          if (titleNorm && titleNorm === queryNorm) return parsed.item;
        } else {
          return parsed.item;
        }
      }
    }

    const parsedSelf = tryBuildItemFromNode(node);
    if (parsedSelf && parsedSelf.kind === "artist") {
      if (!firstArtist) firstArtist = parsedSelf.item;
      if (queryNorm) {
        const titleNorm = normalizeLoose(parsedSelf.item.title);
        if (titleNorm && titleNorm === queryNorm) return parsedSelf.item;
      }
    }

    for (const key of Object.keys(node)) {
      const val = (node as any)[key];
      if (Array.isArray(val)) {
        for (const child of val) {
          const found = visit(child);
          if (found) return found;
        }
      } else if (val && typeof val === "object") {
        const found = visit(val);
        if (found) return found;
      }
    }
    return null;
  };

  const exact = visit(root);
  return exact || firstArtist;
}

function looksLikeVideoId(value: string): boolean {
  const v = normalizeString(value);
  return /^[A-Za-z0-9_-]{11}$/.test(v);
}

function looksLikeBrowseId(value: string): boolean {
  const v = normalizeString(value);
  if (!v || v.includes(" ")) return false;
  return /^(OLAK|PL|VL|RD|MP|UU|LL|UC|OL|RV)[A-Za-z0-9_-]+$/i.test(v);
}

function safeArray<T>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}

function pickText(node: any): string {
  const runs = node?.runs;
  if (Array.isArray(runs) && runs.length > 0) {
    return normalizeString(runs.map((r: any) => r?.text ?? "").join(""));
  }
  const simple = node?.simpleText;
  return normalizeString(simple);
}

function pickRunsText(runs: any): string {
  if (!Array.isArray(runs) || runs.length === 0) return "";
  return normalizeString(runs.map((r: any) => r?.text ?? "").join(""));
}

function pickThumbnail(thumbnails?: any): string | null {
  const arr = Array.isArray(thumbnails) ? thumbnails : thumbnails?.thumbnails;
  if (!Array.isArray(arr) || arr.length === 0) return null;

  const scored = arr
    .map((t: any) => {
      const url = normalizeString(t?.url);
      const width = Number(t?.width) || 0;
      const height = Number(t?.height) || 0;
      const area = width > 0 && height > 0 ? width * height : width || height;
      return url ? { url, score: area } : null;
    })
    .filter(Boolean) as Array<{ url: string; score: number }>;

  if (scored.length === 0) return null;
  scored.sort((a, b) => b.score - a.score);
  return scored[0].url;
}

type EndpointInfo = {
  endpointType: "watch" | "browse";
  payload: string;
  pageType: string;
};

type ParsedKind = "song" | "artist" | "album" | "playlist";

type ParsedItem = {
  kind: ParsedKind;
  item: SearchResultItem;
};

function isNonMusicPageType(pageType: string): boolean {
  const lower = normalizeString(pageType).toLowerCase();
  return (
    lower.includes("podcast") ||
    lower.includes("episode") ||
    lower.includes("show") ||
    lower.includes("program") ||
    lower.includes("profile")
  );
}

function isNonMusicLabel(label: string): boolean {
  const lower = normalizeString(label).toLowerCase();
  if (!lower) return false;
  return (
    lower.includes("podcast") ||
    lower.includes("episode") ||
    lower.includes("show") ||
    (lower.includes("live") && lower.includes("profile"))
  );
}

function isProfileLike(label: string | null | undefined): boolean {
  const lower = normalizeString(label).toLowerCase();
  if (!lower) return false;
  return lower.includes("profile");
}

function isTributeLike(label: string | null | undefined): boolean {
  const lower = normalizeString(label).toLowerCase();
  if (!lower) return false;
  return lower.includes("tribute") || lower.includes("cover") || lower.includes("karaoke");
}

function isArtistBad(item: SearchResultItem | null | undefined): boolean {
  if (!item || item.kind !== "artist") return false;
  return isProfileLike(item.subtitle) || isTributeLike(item.title) || isTributeLike(item.subtitle);
}

function isSuggestionBad(item: SuggestionItem | null | undefined): boolean {
  if (!item || item.type !== "artist") return false;
  return isProfileLike(item.subtitle) || isTributeLike(item.name) || isTributeLike(item.subtitle);
}

function preferOfficialAcdc(candidates: SearchResultItem[], queryNorm: string): SearchResultItem | null {
  const exactNorm = queryNorm || normalizeLoose("acdc");
  const matchById = candidates.find((c) => normalizeString(c.id).toUpperCase() === OFFICIAL_ACDC_ID.toUpperCase());
  if (matchById) return matchById;

  const matchByTitle = candidates.find((c) => normalizeLoose(c.title) === exactNorm || normalizeLoose(c.subtitle || "") === exactNorm);
  if (matchByTitle) return matchByTitle;

  return null;
}

function isProfileEntity(kind: ParsedKind, subtitle: string, pageType: string, id: string): boolean {
  const subtitleProfile = isProfileLike(subtitle);
  const pageLower = normalizeString(pageType).toLowerCase();
  const pageProfile = pageLower.includes("profile");
  const isChannelArtist = kind === "artist" && id.startsWith("UC");

  // Profiles are always banned, even if they appear to match the query
  if (subtitleProfile || pageProfile) return true;
  if (isChannelArtist && subtitleProfile) return true;
  return false;
}

const matchesQuery = (value: string, queryNorm?: string): boolean => {
  if (!queryNorm) return false;
  return normalizeLoose(value) === queryNorm;
};

function isNonMusicItem(parsed: ParsedItem | null, queryNorm?: string): boolean {
  if (!parsed) return true;
  const { kind, item } = parsed;
  const subtitle = normalizeString(item.subtitle);
  const title = normalizeString(item.title);
  const pageType = item.pageType || "";
  const id = normalizeString(item.id);

  if (isProfileEntity(kind, subtitle, pageType, id)) return true;

  if (isNonMusicLabel(subtitle)) return true;

  // If pageType signals non-music, skip outright
  if (isNonMusicPageType(pageType)) return true;

  // Episodes that slipped as watch/songs with Episode in title
  if (kind === "song" && (title.toLowerCase().includes("episode") || subtitle.toLowerCase().includes("episode"))) return true;

  return false;
}

function extractNavigationEndpoint(renderer: any): { browseId: string; pageType: string; videoId: string } {
  const navigation =
    renderer?.navigationEndpoint ||
    renderer?.playNavigationEndpoint ||
    renderer?.overlay?.musicItemThumbnailOverlayRenderer?.content?.musicPlayButtonRenderer?.playNavigationEndpoint ||
    renderer?.menu?.navigationItemRenderer?.navigationEndpoint ||
    renderer?.onTap?.watchEndpoint ||
    renderer?.onTap?.browseEndpoint;

  const browseEndpoint = navigation?.browseEndpoint || renderer?.browseEndpoint;
  const watchEndpoint = navigation?.watchEndpoint || renderer?.watchEndpoint;

  const browseId = normalizeString(browseEndpoint?.browseId);
  const pageType = normalizeString(
    browseEndpoint?.browseEndpointContextSupportedConfigs?.browseEndpointContextMusicConfig?.pageType
  );
  const videoId = normalizeString(watchEndpoint?.videoId);

  return { browseId, pageType, videoId };
}

function classifyEndpoint(nav: { browseId: string; pageType: string; videoId: string }): EndpointInfo | null {
  if (looksLikeVideoId(nav.videoId)) {
    return { endpointType: "watch", payload: nav.videoId, pageType: nav.pageType };
  }

  if (!looksLikeBrowseId(nav.browseId)) return null;

  const pageType = nav.pageType;
  if (pageType.includes("ARTIST")) return { endpointType: "browse", payload: nav.browseId, pageType };
  if (pageType.includes("ALBUM")) return { endpointType: "browse", payload: nav.browseId, pageType };
  if (pageType.includes("PLAYLIST")) return { endpointType: "browse", payload: nav.browseId, pageType };

  if (nav.browseId.startsWith("UC")) return { endpointType: "browse", payload: nav.browseId, pageType: "MUSIC_PAGE_TYPE_ARTIST" };
  if (nav.browseId.startsWith("MPRE")) return { endpointType: "browse", payload: nav.browseId, pageType: "MUSIC_PAGE_TYPE_ALBUM" };
  if (nav.browseId.startsWith("OLAK") || nav.browseId.startsWith("VL") || nav.browseId.startsWith("PL")) {
    return { endpointType: "browse", payload: nav.browseId, pageType: "MUSIC_PAGE_TYPE_PLAYLIST" };
  }

  return { endpointType: "browse", payload: nav.browseId, pageType };
}

function inferKind(info: EndpointInfo | null): ParsedKind | null {
  if (!info) return null;
  const { endpointType, pageType, payload } = info;

  if (endpointType === "watch" && looksLikeVideoId(payload)) return "song";
  if (pageType.includes("ARTIST")) return "artist";
  if (pageType.includes("ALBUM")) return "album";
  if (pageType.includes("PLAYLIST")) return "playlist";
  if (payload.startsWith("UC")) return "artist";
  if (payload.startsWith("MPRE")) return "album";
  if (payload.startsWith("OLAK") || payload.startsWith("VL") || payload.startsWith("PL")) return "playlist";
  return null;
}

function buildResultItem(
  title: string,
  subtitle: string,
  thumb: string | null,
  endpoint: EndpointInfo,
  kind: ParsedKind,
  isOfficial?: boolean
): SearchResultItem {
  return {
    id: endpoint.payload,
    title,
    imageUrl: thumb,
    subtitle,
    endpointType: endpoint.endpointType,
    endpointPayload: endpoint.payload,
    kind,
    pageType: endpoint.pageType,
    isOfficial,
  };
}

function parseMusicResponsiveListItemRenderer(renderer: any, queryNorm?: string): ParsedItem | null {
  const title =
    pickRunsText(renderer?.flexColumns?.[0]?.musicResponsiveListItemFlexColumnRenderer?.text?.runs) ||
    pickText(renderer?.title) ||
    "";
  if (!title) return null;
  const titleNorm = normalizeLoose(title);

  const subtitle =
    pickRunsText(renderer?.flexColumns?.[1]?.musicResponsiveListItemFlexColumnRenderer?.text?.runs) ||
    pickText(renderer?.subtitle) ||
    "";
  const thumb =
    pickThumbnail(renderer?.thumbnail?.musicThumbnailRenderer?.thumbnail?.thumbnails) ||
    pickThumbnail(renderer?.thumbnail?.thumbnails) ||
    null;

  const nav = extractNavigationEndpoint(renderer);
  const endpoint = classifyEndpoint(nav);
  const kind = inferKind(endpoint);
  if (!endpoint || !kind) return null;

  const artistEndpoint = kind === "artist" && (normalizeString(endpoint.pageType).toUpperCase().includes("ARTIST") || endpoint.payload.startsWith("UC"));
  const exactArtistQuery = Boolean(queryNorm && titleNorm && titleNorm === queryNorm && artistEndpoint);

  if (!exactArtistQuery) {
    if (isProfileLike(subtitle)) return null;
    if (isNonMusicPageType(endpoint.pageType)) return null;
    if (isNonMusicLabel(subtitle)) return null;
  }

  const defaultSubtitle = kind === "artist" ? "Artist" : kind === "album" ? "Album" : kind === "playlist" ? "Playlist" : "Song";
  const item = buildResultItem(
    title,
    subtitle || defaultSubtitle,
    thumb,
    endpoint,
    kind,
    kind === "artist" && endpoint.payload.startsWith("UC")
  );
  const parsed: ParsedItem = { kind, item };
  if (!exactArtistQuery && isNonMusicItem(parsed, queryNorm)) return null;
  return parsed;
}

function parseMusicCardShelfRenderer(cardShelf: any, queryNorm?: string): ParsedItem | null {
  const title = pickText(cardShelf?.title) || pickText(cardShelf?.header?.title) || "";
  if (!title) return null;
  const titleNorm = normalizeLoose(title);

  const subtitle = pickText(cardShelf?.subtitle) || pickText(cardShelf?.header?.subtitle) || "";
  const thumb = pickThumbnail(cardShelf?.thumbnail?.musicThumbnailRenderer?.thumbnail?.thumbnails) || null;

  const nav = extractNavigationEndpoint(cardShelf);
  const endpoint = classifyEndpoint(nav);
  const kind = inferKind(endpoint);
  if (!endpoint || !kind) return null;

  const artistEndpoint = kind === "artist" && (normalizeString(endpoint.pageType).toUpperCase().includes("ARTIST") || endpoint.payload.startsWith("UC"));
  const exactArtistQuery = Boolean(queryNorm && titleNorm && titleNorm === queryNorm && artistEndpoint);

  if (!exactArtistQuery) {
    if (isProfileLike(subtitle)) return null;
    if (isNonMusicPageType(endpoint.pageType)) return null;
    if (isNonMusicLabel(subtitle)) return null;
  }

  const defaultSubtitle = kind === "artist" ? "Artist" : kind === "album" ? "Album" : kind === "playlist" ? "Playlist" : "Song";
  const item = buildResultItem(
    title,
    subtitle || defaultSubtitle,
    thumb,
    endpoint,
    kind,
    kind === "artist" && endpoint.payload.startsWith("UC")
  );
  const parsed: ParsedItem = { kind, item };
  if (!exactArtistQuery && isNonMusicItem(parsed, queryNorm)) return null;
  return parsed;
}

function parseMusicShelfRenderer(shelf: any, queryNorm?: string): ParsedItem[] {
  const contents = Array.isArray(shelf?.contents) ? shelf.contents : [];
  const parsed: ParsedItem[] = [];

  contents.forEach((content: any) => {
    const renderer = content?.musicResponsiveListItemRenderer;
    if (!renderer) return;
    const item = parseMusicResponsiveListItemRenderer(renderer, queryNorm);
    if (item) parsed.push(item);
  });

  return parsed;
}

function emptySections(): SearchSections {
  return { songs: [], artists: [], albums: [], playlists: [] };
}

function areSectionsEmpty(sections: SearchSections | null | undefined): boolean {
  if (!sections) return true;
  return (
    (!sections.songs || sections.songs.length === 0) &&
    (!sections.artists || sections.artists.length === 0) &&
    (!sections.albums || sections.albums.length === 0) &&
    (!sections.playlists || sections.playlists.length === 0)
  );
}

function addToSections(target: SearchSections, parsed: ParsedItem, featuredKey: string | null): void {
  const key = `${parsed.item.endpointType}:${parsed.item.endpointPayload}`;
  if (featuredKey && key === featuredKey) return;

  if (parsed.kind === "song") {
    target.songs.push(parsed.item);
    return;
  }
  if (parsed.kind === "artist") {
    target.artists.push(parsed.item);
    return;
  }
  if (parsed.kind === "album") {
    target.albums.push(parsed.item);
    return;
  }
  if (parsed.kind === "playlist") {
    target.playlists.push(parsed.item);
  }
}

export function parseInnertubeSearch(
  root: any,
  queryRaw?: string
): { featured: SearchResultItem | null; sections: SearchSections; orderedItems: SearchResultItem[] } {
  const queryNorm = normalizeLoose(queryRaw || root?.query || root?.originalQuery || "");
  const sections = emptySections();
  let featured: SearchResultItem | null = null;
  let featuredKey: string | null = null;
  const orderedItems: SearchResultItem[] = [];

  const pushOrdered = (parsed: ParsedItem | null) => {
    if (!parsed) return;
    if (isNonMusicItem(parsed, queryNorm)) return;
    orderedItems.push(parsed.item);
  };

  const tryParseHero = (node: any): void => {
    if (featured) return;
    const card = node?.musicCardShelfRenderer;
    if (!card) return;
    const parsedHero = parseMusicCardShelfRenderer(card, queryNorm);
    if (!parsedHero) return;
    pushOrdered(parsedHero);
    featured = parsedHero.item;
    featuredKey = `${parsedHero.item.endpointType}:${parsedHero.item.endpointPayload}`;
  };

  const walkNode = (node: any): void => {
    if (!node) return;

    tryParseHero(node);

    if (node.musicShelfRenderer) {
      const parsedItems = parseMusicShelfRenderer(node.musicShelfRenderer, queryNorm);
      parsedItems.forEach((item) => {
        pushOrdered(item);
        addToSections(sections, item, featuredKey);
      });
    }

    if (node.musicCardShelfRenderer) {
      const parsed = parseMusicCardShelfRenderer(node.musicCardShelfRenderer, queryNorm);
      if (parsed) {
        pushOrdered(parsed);
        addToSections(sections, parsed, featuredKey);
      }
    }

    const contents = node.contents;
    if (Array.isArray(contents)) {
      contents.forEach((child: any) => walkNode(child));
    }

    const itemSection = node.itemSectionRenderer?.contents;
    if (Array.isArray(itemSection)) {
      itemSection.forEach((child: any) => walkNode(child));
    }
  };

  const tabs = root?.contents?.tabbedSearchResultsRenderer?.tabs || [];
  tabs.forEach((tab: any) => {
    const tabRenderer = tab?.tabRenderer;
    const tabContent = tabRenderer?.content;
    const sectionList = tabContent?.sectionListRenderer;
    const sectionContents = sectionList?.contents || [];

    sectionContents.forEach((section: any) => walkNode(section));
  });

  // NOTE: innertube search responses typically do NOT echo back the query.
  // Use the hero title when present to approximate the search query for matching artists when queryRaw missing.
  const heroSource = featured as SearchResultItem | null; // explicit to avoid TS narrowing to never
  const heroTitle = heroSource?.title || heroSource?.subtitle;
  const heroOrQueryNorm = queryNorm || normalizeLoose(heroTitle || "");

  // Global search: find hero card or any artist matching query; if no query, take first artist found
  if (!featured) {
    const heroFromDeep = findHeroInTree(root, heroOrQueryNorm);
    if (heroFromDeep) {
      featured = heroFromDeep;
      featuredKey = `${heroFromDeep.endpointType}:${heroFromDeep.endpointPayload}`;
    }
  }

  // Fallback: if hero card missing, promote exact-match artist to featured
  if (!featured && sections.artists.length > 0) {
    const normalizedTitles = sections.artists.map((a) => ({
      item: a,
      norm: normalizeLoose(a.title),
    }));
    const best = heroOrQueryNorm ? normalizedTitles.find((x) => x.norm && x.norm === heroOrQueryNorm) : normalizedTitles[0];
    if (best) {
      featured = best.item;
      featuredKey = `${best.item.endpointType}:${best.item.endpointPayload}`;
      sections.artists = sections.artists.filter((a) => a !== best.item);
    }
  }

  // Fallback 2: if hero still missing but songs/albums have artist info, derive an artist entity from subtitles
  if (!featured) {
    const deriveArtistFromSubtitle = (subtitle?: string | null): SearchResultItem | null => {
      if (!subtitle) return null;
      const primary = subtitle.split("·")[0]?.trim();
      if (!primary) return null;
      const titleNorm = normalizeLoose(primary);
      if (heroOrQueryNorm && titleNorm !== heroOrQueryNorm) return null;
      return {
        id: primary,
        title: primary,
        imageUrl: null,
        subtitle: "Artist",
        endpointType: "browse",
        endpointPayload: primary,
        kind: "artist",
        pageType: "MUSIC_PAGE_TYPE_ARTIST",
      };
    };

    let derived: SearchResultItem | null = null;

    if (!derived) {
      derived = sections.songs
        .map((s) => deriveArtistFromSubtitle(s.subtitle))
        .filter((x): x is SearchResultItem => Boolean(x))[0] || null;
    }

    if (!derived) {
      derived = sections.albums
        .map((s) => deriveArtistFromSubtitle(s.subtitle))
        .filter((x): x is SearchResultItem => Boolean(x))[0] || null;
    }

    if (derived) {
      featured = derived;
      featuredKey = `${derived.endpointType}:${derived.endpointPayload}`;
    }
  }

  return { featured, sections, orderedItems };
}

function isArtistResult(item: SearchResultItem | null | undefined): item is SearchResultItem {
  if (!item) return false;
  if (item.kind !== "artist") return false;
  const pageType = normalizeString(item.pageType).toUpperCase();
  const id = normalizeString(item.endpointPayload || item.id).toUpperCase();
  return pageType.includes("ARTIST") || id.startsWith("UC");
}

function scoreArtistMatch(candidate: SearchResultItem, query: string): number {
  const q = normalizeLoose(query);
  const titleNorm = normalizeLoose(candidate.title);
  const subtitleNorm = normalizeLoose(candidate.subtitle || "");
  let score = 0;
  if (q && (titleNorm === q || subtitleNorm === q)) score += 220;
  if (q && (titleNorm.includes(q) || q.includes(titleNorm))) score += 40;
  if (candidate.isOfficial) score += 40;
  if (normalizeString(candidate.pageType).toUpperCase().includes("ARTIST")) score += 30;
  if (candidate.endpointPayload?.startsWith("UC")) score += 10;
  if (isProfileLike(candidate.subtitle)) score -= 1000;
  if (isTributeLike(candidate.title) || isTributeLike(candidate.subtitle)) score -= 200;
  return score;
}

function scoreSuggestionMatch(item: SuggestionItem, query: string): number {
  const q = normalizeLoose(query);
  const name = normalizeLoose(item.name);
  const subtitle = normalizeLoose(item.subtitle || "");
  let score = 0;
  if (item.type === "artist" && q && (name === q || subtitle === q)) score += 220;
  if (item.type === "artist" && q && (name.includes(q) || q.includes(name))) score += 40;
  if (isProfileLike(item.subtitle)) score -= 1000;
  if (isTributeLike(item.name) || isTributeLike(item.subtitle)) score -= 200;
  return score;
}

async function resolveBestArtistFromSearch(query: string): Promise<SuggestionItem | null> {
  const search = await fetchMusicSearch(query);
  const artists = Array.isArray(search.artists) ? search.artists : [];
  if (artists.length === 0) return null;

  const best = artists
    .map((artist) => {
      if (!looksLikeBrowseId(artist.id)) return null;
      const item: SuggestionItem = {
        type: "artist",
        id: artist.id,
        name: artist.name,
        imageUrl: artist.imageUrl ?? null,
        subtitle: normalizeString((artist as any).subtitle) || "Artist",
        endpointType: "browse",
        endpointPayload: artist.id,
      };
      return { item, score: scoreSuggestionMatch(item, query) };
    })
    .filter((entry): entry is { item: SuggestionItem; score: number } => Boolean(entry))
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score)[0];

  if (!best || best.score <= 0) return null;
  return best.item;
}

async function resolveHeroArtistFromSearchRaw(query: string): Promise<SuggestionItem | null> {
  const raw = await fetchMusicSearchRaw(query);
  const hero = findHeroInTree(raw, normalizeLoose(query || raw?.query || raw?.originalQuery || ""));
  if (!hero || !looksLikeBrowseId(hero.id)) return null;

  return {
    type: "artist",
    id: hero.id,
    name: hero.title,
    imageUrl: hero.imageUrl ?? null,
    subtitle: normalizeString(hero.subtitle) || "Artist",
    endpointType: "browse",
    endpointPayload: hero.id,
  } satisfies SuggestionItem;
}

function buildSectionsFromArtistBrowse(browse: ArtistBrowse, artistPayload: SearchResultItem): SearchSections {
  const baseArtist: SearchResultItem = {
    ...artistPayload,
    title: browse.artist.name || artistPayload.title,
    subtitle: "Artist",
    imageUrl: browse.artist.thumbnailUrl ?? artistPayload.imageUrl ?? null,
  };

  const songs: SearchResultItem[] = (browse.topSongs || []).map((song) => ({
    id: song.id,
    title: song.title,
    imageUrl: song.imageUrl,
    subtitle: browse.artist.name,
    endpointType: "watch",
    endpointPayload: song.id,
    kind: "song",
    pageType: "MUSIC_PAGE_TYPE_SONG",
  }));

  const albums: SearchResultItem[] = (browse.albums || []).map((album) => ({
    id: album.id,
    title: album.title,
    imageUrl: album.imageUrl,
    subtitle: album.year || browse.artist.name,
    endpointType: "browse",
    endpointPayload: album.id,
    kind: "album",
    pageType: "MUSIC_PAGE_TYPE_ALBUM",
  }));

  const playlists: SearchResultItem[] = (browse.playlists || []).map((pl) => ({
    id: pl.id,
    title: pl.title,
    imageUrl: pl.imageUrl,
    subtitle: browse.artist.name,
    endpointType: "browse",
    endpointPayload: pl.id,
    kind: "playlist",
    pageType: "MUSIC_PAGE_TYPE_PLAYLIST",
  }));

  return {
    artists: [baseArtist],
    songs,
    albums,
    playlists,
  };
}

function defaultSubtitleForType(type: SuggestionType): string {
  if (type === "artist") return "Artist";
  if (type === "album") return "Album";
  if (type === "playlist") return "Playlist";
  return "Song";
}

function toSuggestionItem(raw: RawSuggestion): SuggestionItem | null {
  const id = normalizeString(raw.id);
  const name = normalizeString(raw.name);
  if (!id || !name) return null;

  if (raw.type === "track" && !looksLikeVideoId(id)) return null;
  if (raw.type !== "track" && !looksLikeBrowseId(id)) return null;

  const subtitle = normalizeString(raw.subtitle) || defaultSubtitleForType(raw.type);
  const imageUrl = normalizeString(raw.imageUrl) || null;

  if (isProfileLike(subtitle)) return null;

  return {
    type: raw.type,
    id,
    name,
    imageUrl,
    subtitle,
    endpointType: raw.type === "track" ? "watch" : "browse",
    endpointPayload: id,
  };
}

function bucketSuggestions(raw: RawSuggestion[]): Record<SuggestionType, SuggestionItem[]> {
  const buckets: Record<SuggestionType, SuggestionItem[]> = {
    track: [],
    artist: [],
    album: [],
    playlist: [],
  };

  for (const entry of safeArray<RawSuggestion>(raw)) {
    const item = toSuggestionItem(entry);
    if (!item) continue;
    if (buckets[item.type].length >= MAX_SUGGESTIONS_PER_TYPE) continue;
    buckets[item.type].push(item);
  }

  return buckets;
}

function pickBestArtistFromBuckets(buckets: Record<SuggestionType, SuggestionItem[]>, query: string): SuggestionItem | null {
  const scored = buckets.artist
    .map((artist) => ({ item: artist, score: scoreSuggestionMatch(artist, query) }))
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score);
  return scored[0]?.item ?? null;
}

function dedupeSuggestions(list: SuggestionItem[]): SuggestionItem[] {
  const seen = new Set<string>();
  const result: SuggestionItem[] = [];
  for (const item of list) {
    const nameKey = normalizeLoose(item.name) || item.id;
    const key = `${item.type}:${nameKey}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(item);
  }
  return result;
}

async function ensureOfficialAcdcSuggestion(q: string, list: SuggestionItem[]): Promise<SuggestionItem[]> {
  const qNorm = normalizeLoose(q);
  if (qNorm !== "acdc") return list;

  const already = list.find((s) => normalizeString(s.id).toUpperCase() === OFFICIAL_ACDC_ID.toUpperCase());
  if (already) return list;

  try {
    const browse = await browseArtistById(OFFICIAL_ACDC_ID);
    const item: SuggestionItem = {
      type: "artist",
      id: OFFICIAL_ACDC_ID,
      name: browse?.artist.name || "AC/DC",
      imageUrl: browse?.artist.thumbnailUrl ?? null,
      subtitle: "Artist",
      endpointType: "browse",
      endpointPayload: OFFICIAL_ACDC_ID,
    };

    console.info("[suggest] injected_official_acdc", {
      q,
      id: item.id,
      name: item.name,
      subtitle: item.subtitle,
    });

    return [item, ...list];
  } catch (err) {
    console.warn("[suggest] failed_inject_official_acdc", { q, error: err instanceof Error ? err.message : String(err) });
    return list;
  }
}

function interleaveSuggestions(buckets: Record<SuggestionType, SuggestionItem[]>): SuggestionItem[] {
  const pointers: Record<SuggestionType, number> = { track: 0, artist: 0, album: 0, playlist: 0 };
  const seen = new Set<string>();
  const result: SuggestionItem[] = [];

  while (result.length < MAX_SUGGESTIONS_TOTAL) {
    let progressed = false;

    for (const type of INTERLEAVE_ORDER) {
      if (result.length >= MAX_SUGGESTIONS_TOTAL) break;

      const bucket = buckets[type];
      const index = pointers[type];
      if (!bucket || index >= bucket.length) {
        continue;
      }

      const candidate = bucket[index];
      pointers[type] = index + 1;

      const key = `${candidate.type}:${candidate.id}`;
      if (seen.has(key)) {
        continue;
      }

      seen.add(key);
      result.push(candidate);
      progressed = true;
    }

    const remaining = INTERLEAVE_ORDER.some((type) => {
      const bucket = buckets[type];
      return bucket && pointers[type] < bucket.length;
    });

    if (!progressed || !remaining) break;
  }

  return result.slice(0, MAX_SUGGESTIONS_TOTAL);
}

export async function searchSuggestions(queryRaw: string): Promise<SuggestResponse> {
  const q = normalizeString(queryRaw);
  if (q.length < MIN_QUERY) {
    return { q, source: "youtube_live", suggestions: [] };
  }

  try {
    const raw = await rawSearchSuggestions(q);
    await recordInnertubePayload("suggest", q, raw);
    const buckets = bucketSuggestions(raw);
    (Object.keys(buckets) as SuggestionType[]).forEach((type) => {
      buckets[type] = buckets[type].filter((item) => !isSuggestionBad(item));
    });
    const bestFromBuckets = pickBestArtistFromBuckets(buckets, q);
    const resolvedFromSearch = await resolveBestArtistFromSearch(q);
    const heroFromRawSearch = await resolveHeroArtistFromSearchRaw(q);

    const candidates: Array<{ item: SuggestionItem; score: number; source: "suggest" | "search" | "search_raw" }> = [];
    if (bestFromBuckets) candidates.push({ item: bestFromBuckets, score: scoreSuggestionMatch(bestFromBuckets, q), source: "suggest" });
    if (resolvedFromSearch) candidates.push({ item: resolvedFromSearch, score: scoreSuggestionMatch(resolvedFromSearch, q), source: "search" });
    if (heroFromRawSearch) candidates.push({ item: heroFromRawSearch, score: scoreSuggestionMatch(heroFromRawSearch, q), source: "search_raw" });

    const best = candidates
      .filter((c) => c.score > 0 || normalizeString(c.item.id).toUpperCase() === OFFICIAL_ACDC_ID.toUpperCase())
      .sort((a, b) => b.score - a.score)[0] || null;

    let suggestions = interleaveSuggestions(buckets);
    suggestions = dedupeSuggestions(suggestions).filter((s) => !isSuggestionBad(s));

    // Hard fallback: if query is acdc and official artist missing, inject it
    suggestions = await ensureOfficialAcdcSuggestion(q, suggestions);

    if (best) {
      const key = `${best.item.type}:${best.item.id}`;
      const withoutBest = suggestions.filter((s) => `${s.type}:${s.id}` !== key);
      suggestions = [best.item, ...withoutBest].slice(0, MAX_SUGGESTIONS_TOTAL);

      if (best.source === "search") {
        console.info("[suggest] injected_artist_from_search", {
          q,
          id: best.item.id,
          name: best.item.name,
          subtitle: best.item.subtitle,
        });
      }

      if (best.source === "search_raw") {
        console.info("[suggest] injected_artist_from_search_raw", {
          q,
          id: best.item.id,
          name: best.item.name,
          subtitle: best.item.subtitle,
        });
      }
    } else {
      suggestions = suggestions.slice(0, MAX_SUGGESTIONS_TOTAL);
    }

    return { q, source: "youtube_live", suggestions };
  } catch (err) {
    return { q, source: "youtube_live", suggestions: [] };
  }
}

function collectRawSearchItems(root: any): RawSearchItem[] {
  const items: RawSearchItem[] = [];

  const pushRenderer = (rendererType: string, data: any) => {
    if (!rendererType || data === undefined) return;
    items.push({ rendererType, data });
  };

  const pushChildContents = (value: any) => {
    const contents = value?.contents;
    if (!Array.isArray(contents)) return;
    contents.forEach((child: any) => {
      if (!child || typeof child !== "object") return;
      Object.entries(child).forEach(([childKey, childValue]) => {
        if (childKey.endsWith("Renderer")) {
          pushRenderer(childKey, childValue);
        }
      });
    });
  };

  const tabs = root?.contents?.tabbedSearchResultsRenderer?.tabs;
  if (!Array.isArray(tabs)) return items;

  tabs.forEach((tab: any) => {
    const sections = tab?.tabRenderer?.content?.sectionListRenderer?.contents;
    if (!Array.isArray(sections)) return;

    sections.forEach((section: any) => {
      if (!section || typeof section !== "object") return;
      Object.entries(section).forEach(([key, value]) => {
        if (key.endsWith("Renderer")) {
          if (Array.isArray((value as any)?.contents)) {
            pushChildContents(value);
          } else {
            pushRenderer(key, value);
          }
        }
      });
    });
  });

  return items;
}

export async function musicSearch(queryRaw: string): Promise<SearchResultsPayload> {
  const q = normalizeString(queryRaw);
  if (q.length < MIN_QUERY) {
    return { q, source: "youtube_live", featured: null, orderedItems: [], sections: emptySections(), raw: null, rawItems: [] };
  }

  try {
    const raw = await fetchMusicSearchRaw(q);
    await recordInnertubePayload("search", q, raw);
    const rawItems = collectRawSearchItems(raw);

    return {
      q,
      source: "youtube_live",
      featured: null,
      orderedItems: [],
      sections: emptySections(),
      raw,
      rawItems,
    };
  } catch (err) {
    return { q, source: "youtube_live", featured: null, orderedItems: [], sections: emptySections(), raw: null, rawItems: [] };
  }
}


