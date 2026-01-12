import {
  musicSearchRaw as fetchMusicSearchRaw,
  searchSuggestions as rawSearchSuggestions,
  type MusicSearchSuggestion as RawSuggestion,
} from "../services/youtubeMusicClient";
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
  sections: SearchSections;
};

const MIN_QUERY = 2;
const MAX_SUGGESTIONS_TOTAL = 12;
const MAX_SUGGESTIONS_PER_TYPE = 4;
const INTERLEAVE_ORDER: SuggestionType[] = ["track", "artist", "playlist", "album"];

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
  kind: ParsedKind
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
  };
}

function parseMusicResponsiveListItemRenderer(renderer: any): ParsedItem | null {
  const title =
    pickRunsText(renderer?.flexColumns?.[0]?.musicResponsiveListItemFlexColumnRenderer?.text?.runs) ||
    pickText(renderer?.title) ||
    "";
  if (!title) return null;

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

  const defaultSubtitle = kind === "artist" ? "Artist" : kind === "album" ? "Album" : kind === "playlist" ? "Playlist" : "Song";
  const item = buildResultItem(title, subtitle || defaultSubtitle, thumb, endpoint, kind);
  return { kind, item };
}

function parseMusicCardShelfRenderer(cardShelf: any): ParsedItem | null {
  const title = pickText(cardShelf?.title) || pickText(cardShelf?.header?.title) || "";
  if (!title) return null;

  const subtitle = pickText(cardShelf?.subtitle) || pickText(cardShelf?.header?.subtitle) || "";
  const thumb = pickThumbnail(cardShelf?.thumbnail?.musicThumbnailRenderer?.thumbnail?.thumbnails) || null;

  const nav = extractNavigationEndpoint(cardShelf);
  const endpoint = classifyEndpoint(nav);
  const kind = inferKind(endpoint);
  if (!endpoint || !kind) return null;

  const defaultSubtitle = kind === "artist" ? "Artist" : kind === "album" ? "Album" : kind === "playlist" ? "Playlist" : "Song";
  const item = buildResultItem(title, subtitle || defaultSubtitle, thumb, endpoint, kind);
  return { kind, item };
}

function parseMusicShelfRenderer(shelf: any): ParsedItem[] {
  const contents = Array.isArray(shelf?.contents) ? shelf.contents : [];
  const parsed: ParsedItem[] = [];

  contents.forEach((content: any) => {
    const renderer = content?.musicResponsiveListItemRenderer;
    if (!renderer) return;
    const item = parseMusicResponsiveListItemRenderer(renderer);
    if (item) parsed.push(item);
  });

  return parsed;
}

function emptySections(): SearchSections {
  return { songs: [], artists: [], albums: [], playlists: [] };
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

export function parseInnertubeSearch(root: any): { featured: SearchResultItem | null; sections: SearchSections } {
  const sections = emptySections();
  let featured: SearchResultItem | null = null;
  let featuredKey: string | null = null;

  const tryParseHero = (node: any): void => {
    if (featured) return;
    const card = node?.musicCardShelfRenderer;
    if (!card) return;
    const parsedHero = parseMusicCardShelfRenderer(card);
    if (!parsedHero) return;
    featured = parsedHero.item;
    featuredKey = `${parsedHero.item.endpointType}:${parsedHero.item.endpointPayload}`;
  };

  const walkNode = (node: any): void => {
    if (!node) return;

    tryParseHero(node);

    if (node.musicShelfRenderer) {
      const parsedItems = parseMusicShelfRenderer(node.musicShelfRenderer);
      parsedItems.forEach((item) => addToSections(sections, item, featuredKey));
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

  const queryNorm = normalizeLoose(root?.query || root?.originalQuery || "");

  // Global search: find hero card or any artist matching query; if no query, take first artist found
  if (!featured) {
    const heroFromDeep = findHeroInTree(root, queryNorm);
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
    const best = queryNorm ? normalizedTitles.find((x) => x.norm && x.norm === queryNorm) : normalizedTitles[0];
    if (best) {
      featured = best.item;
      featuredKey = `${best.item.endpointType}:${best.item.endpointPayload}`;
      sections.artists = sections.artists.filter((a) => a !== best.item);
    }
  }

  return { featured, sections };
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
    const buckets = bucketSuggestions(raw);
    const suggestions = interleaveSuggestions(buckets);
    return { q, source: "youtube_live", suggestions };
  } catch (err) {
    return { q, source: "youtube_live", suggestions: [] };
  }
}

export async function musicSearch(queryRaw: string): Promise<SearchResultsPayload> {
  const q = normalizeString(queryRaw);
  if (q.length < MIN_QUERY) {
    return { q, source: "youtube_live", featured: null, sections: emptySections() };
  }

  try {
    const raw = await fetchMusicSearchRaw(q);
    await recordInnertubePayload("search", q, raw);
    const parsed = parseInnertubeSearch(raw);
    return { q, source: "youtube_live", featured: parsed.featured, sections: parsed.sections };
  } catch (err) {
    return { q, source: "youtube_live", featured: null, sections: emptySections() };
  }
}
  
      // Fallback 2: if hero still missing but songs/albums have artist info, derive an artist entity
      if (!featured) {
        const deriveArtistFromSubtitle = (subtitle?: string | null): SearchResultItem | null => {
          if (!subtitle) return null;
          const primary = subtitle.split("·")[0]?.trim();
          if (!primary) return null;
          const titleNorm = normalizeLoose(primary);
          if (queryNorm && titleNorm !== queryNorm) return null;
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
