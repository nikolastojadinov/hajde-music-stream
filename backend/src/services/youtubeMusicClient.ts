import { CONSENT_COOKIES, fetchInnertubeConfig, type InnertubeConfig } from "./youtubeInnertubeConfig";
import { parseArtistBrowseFromInnertube, type ArtistBrowse } from "./ytmArtistParser";

export type { ArtistBrowse } from "./ytmArtistParser";

const YTM_USER_AGENT = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

function normalizeString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function looksLikeVideoId(value: string): boolean {
  const v = normalizeString(value);
  return /^[A-Za-z0-9_-]{11}$/.test(v);
}

function isMusicPageType(pageType: unknown, match: string): boolean {
  return typeof pageType === "string" && pageType.includes(match);
}

function pickText(node: any): string {
  const runs = node?.runs;
  if (Array.isArray(runs) && runs.length > 0) {
    return normalizeString(runs.map((r: any) => r?.text ?? "").join(""));
  }
  const simple = node?.simpleText;
  return normalizeString(simple);
}

function pickThumbnail(thumbnails?: any): string | null {
  const arr = Array.isArray(thumbnails) ? thumbnails : thumbnails?.thumbnails;
  if (!Array.isArray(arr)) return null;
  for (const t of arr) {
    const url = normalizeString(t?.url);
    if (url) return url;
  }
  return null;
}

export type MusicSearchSuggestion = {
  type: "artist" | "track" | "album" | "playlist";
  id: string;
  name: string;
  subtitle?: string;
  imageUrl?: string;
  artists?: string[];
};

export type MusicSearchTrack = {
  id: string;
  title: string;
  artist: string;
  youtubeId: string;
  imageUrl?: string;
};

export type MusicSearchArtist = {
  id: string;
  name: string;
  imageUrl?: string;
};

export type MusicSearchAlbum = {
  id: string;
  title: string;
  channelId?: string | null;
  channelTitle?: string | null;
  imageUrl?: string;
};

export type MusicSearchPlaylist = {
  id: string;
  title: string;
  channelId?: string | null;
  channelTitle?: string | null;
  imageUrl?: string;
};

export type MusicSearchSection = {
  kind: string;
  title?: string | null;
  items: Array<MusicSearchTrack | MusicSearchArtist | MusicSearchAlbum | MusicSearchPlaylist>;
};

export type MusicSearchResults = {
  tracks: MusicSearchTrack[];
  artists: MusicSearchArtist[];
  albums: MusicSearchAlbum[];
  playlists: MusicSearchPlaylist[];
  sections: MusicSearchSection[];
  refinements: string[];
  suggestions: MusicSearchSuggestion[];
};

type ParsedItem =
  | { variant: "track"; value: MusicSearchTrack }
  | { variant: "artist"; value: MusicSearchArtist }
  | { variant: "album"; value: MusicSearchAlbum }
  | { variant: "playlist"; value: MusicSearchPlaylist };

function logKeys(_label: string, _obj: any): void {
  return;
}

function logArrayItem(_label: string, _index: number, _obj: any): void {
  return;
}

function buildSearchBody(config: InnertubeConfig, query: string): any {
  return {
    context: {
      client: {
        clientName: config.clientName,
        clientVersion: config.clientVersion,
        hl: "en",
        gl: "US",
        platform: "DESKTOP",
        visitorData: config.visitorData,
        userAgent: YTM_USER_AGENT,
        utcOffsetMinutes: 0,
      },
      user: { enableSafetyMode: false },
      request: {
        internalExperimentFlags: [],
        sessionIndex: 0,
      },
    },
    query,
  };
}

function resolveApiBase(config: InnertubeConfig): string {
  return config.apiBase.endsWith("/") ? config.apiBase : `${config.apiBase}/`;
}

async function loadConfigOrThrow(): Promise<InnertubeConfig> {
  try {
    return await fetchInnertubeConfig();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[Innertube][config] ${message}`);
    throw err instanceof Error ? err : new Error(message);
  }
}

async function callYoutubei<T = any>(config: InnertubeConfig, path: string, payload: Record<string, any>): Promise<T> {
  const base = resolveApiBase(config);
  const url = `${base}${path}?prettyPrint=false&key=${encodeURIComponent(config.apiKey)}`;

  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      "Accept-Language": "en-US,en;q=0.9",
      "User-Agent": YTM_USER_AGENT,
      Origin: "https://music.youtube.com",
      Referer: "https://music.youtube.com/search",
      Cookie: CONSENT_COOKIES,
      "X-Goog-Visitor-Id": config.visitorData,
      "X-YouTube-Client-Name": "67",
      "X-YouTube-Client-Version": config.clientVersion,
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    throw new Error(`Innertube request failed: ${response.status}`);
  }

  const json = (await response.json()) as T;
  return json;
}

function parseListItem(item: any): ParsedItem | null {
  logKeys("musicResponsiveListItemRenderer", item);

  const title = pickText(item?.flexColumns?.[0]?.musicResponsiveListItemFlexColumnRenderer?.text?.runs?.[0]);
  const subtitlesRuns = item?.flexColumns?.[1]?.musicResponsiveListItemFlexColumnRenderer?.text?.runs;
  const subtitle = Array.isArray(subtitlesRuns) ? subtitlesRuns.map((r: any) => r?.text ?? "").join("") : "";

  const navigation = item?.navigationEndpoint || item?.overlay?.musicItemThumbnailOverlayRenderer?.content?.musicPlayButtonRenderer?.playNavigationEndpoint;
  const browseEndpoint = navigation?.browseEndpoint;
  const watchEndpoint = navigation?.watchEndpoint;

  const thumb = pickThumbnail(item?.thumbnail?.musicThumbnailRenderer?.thumbnail?.thumbnails);

  if (watchEndpoint?.videoId && looksLikeVideoId(watchEndpoint.videoId) && title) {
    return {
      variant: "track",
      value: {
        id: watchEndpoint.videoId,
        title: title || "Unknown",
        artist: subtitle || "",
        youtubeId: watchEndpoint.videoId,
        imageUrl: thumb || undefined,
      },
    };
  }

  const browseId = normalizeString(browseEndpoint?.browseId);
  const pageType = browseEndpoint?.browseEndpointContextSupportedConfigs?.browseEndpointContextMusicConfig?.pageType;

  if (browseId && isMusicPageType(pageType, "MUSIC_PAGE_TYPE_ARTIST") && (title || subtitle)) {
    return {
      variant: "artist",
      value: {
        id: browseId,
        name: title || subtitle || "",
        imageUrl: thumb || undefined,
      },
    };
  }

  if (browseId && isMusicPageType(pageType, "MUSIC_PAGE_TYPE_ALBUM") && title) {
    return {
      variant: "album",
      value: {
        id: browseId,
        title,
        channelId: null,
        channelTitle: subtitle || null,
        imageUrl: thumb || undefined,
      },
    };
  }

  if (browseId && isMusicPageType(pageType, "MUSIC_PAGE_TYPE_PLAYLIST") && title) {
    return {
      variant: "playlist",
      value: {
        id: browseId,
        title,
        channelId: null,
        channelTitle: subtitle || null,
        imageUrl: thumb || undefined,
      },
    };
  }

  return null;
}

function parseTwoRowItem(item: any): ParsedItem | null {
  logKeys("musicTwoRowItemRenderer", item);

  const title = pickText(item?.title) || "";
  const subtitle = pickText(item?.subtitle) || "";
  const thumb = pickThumbnail(item?.thumbnailRenderer?.musicThumbnailRenderer?.thumbnail?.thumbnails);

  const browseEndpoint = item?.navigationEndpoint?.browseEndpoint;
  const pageType = browseEndpoint?.browseEndpointContextSupportedConfigs?.browseEndpointContextMusicConfig?.pageType;
  const browseId = normalizeString(browseEndpoint?.browseId);

  if (!browseId || !title) return null;

  if (isMusicPageType(pageType, "MUSIC_PAGE_TYPE_ALBUM")) {
    return {
      variant: "album",
      value: {
        id: browseId,
        title,
        channelId: null,
        channelTitle: subtitle || null,
        imageUrl: thumb || undefined,
      },
    };
  }

  if (isMusicPageType(pageType, "MUSIC_PAGE_TYPE_PLAYLIST")) {
    return {
      variant: "playlist",
      value: {
        id: browseId,
        title,
        channelId: null,
        channelTitle: subtitle || null,
        imageUrl: thumb || undefined,
      },
    };
  }

  if (isMusicPageType(pageType, "MUSIC_PAGE_TYPE_ARTIST")) {
    return {
      variant: "artist",
      value: {
        id: browseId,
        name: title || subtitle || "",
        imageUrl: thumb || undefined,
      },
    };
  }

  return null;
}

function inferKind(parsedItems: ParsedItem[]): string {
  const variantSet = new Set(parsedItems.map((p) => p.variant));
  if (variantSet.has("track")) return "songs";
  if (variantSet.has("artist")) return "artists";
  if (variantSet.has("album")) return "albums";
  if (variantSet.has("playlist")) return "playlists";
  return "unknown";
}

function parseShelfRenderer(shelf: any): { section: MusicSearchSection | null; collected: ParsedItem[] } {
  logKeys("musicShelfRenderer", shelf);

  const contents = Array.isArray(shelf?.contents) ? shelf.contents : [];
  const parsedItems: ParsedItem[] = [];

  contents.forEach((content: any, idx: number) => {
    logArrayItem("musicShelfRenderer.contents", idx, content);
    const renderer = content?.musicResponsiveListItemRenderer;
    if (!renderer) return;
    const parsed = parseListItem(renderer);
    if (parsed) parsedItems.push(parsed);
  });

  if (parsedItems.length === 0) return { section: null, collected: [] };

  const section: MusicSearchSection = {
    kind: inferKind(parsedItems),
    title: pickText(shelf?.title) || null,
    items: parsedItems.map((p) => p.value),
  };

  return { section, collected: parsedItems };
}

function parseCarouselRenderer(carousel: any): { section: MusicSearchSection | null; collected: ParsedItem[] } {
  logKeys("musicCarouselShelfRenderer", carousel);

  const cards = Array.isArray(carousel?.contents) ? carousel.contents : [];
  const parsedItems: ParsedItem[] = [];

  cards.forEach((card: any, idx: number) => {
    logArrayItem("musicCarouselShelfRenderer.contents", idx, card);
    const renderer = card?.musicTwoRowItemRenderer;
    if (!renderer) return;
    const parsed = parseTwoRowItem(renderer);
    if (parsed) parsedItems.push(parsed);
  });

  if (parsedItems.length === 0) return { section: null, collected: [] };

  const section: MusicSearchSection = {
    kind: inferKind(parsedItems),
    title: pickText(carousel?.header?.musicCarouselShelfBasicHeaderRenderer?.title) || pickText(carousel?.header?.musicCarouselShelfRenderer?.title) || null,
    items: parsedItems.map((p) => p.value),
  };

  return { section, collected: parsedItems };
}

function parseCardShelfRenderer(cardShelf: any): { section: MusicSearchSection | null; collected: ParsedItem[] } {
  logKeys("musicCardShelfRenderer", cardShelf);
  const contents = Array.isArray(cardShelf?.contents) ? cardShelf.contents : [];
  const parsedItems: ParsedItem[] = [];

  contents.forEach((content: any, idx: number) => {
    logArrayItem("musicCardShelfRenderer.contents", idx, content);
    const twoRow = content?.musicTwoRowItemRenderer;
    if (twoRow) {
      const parsed = parseTwoRowItem(twoRow);
      if (parsed) parsedItems.push(parsed);
    }
  });

  if (parsedItems.length === 0) return { section: null, collected: [] };

  const section: MusicSearchSection = {
    kind: inferKind(parsedItems),
    title: pickText(cardShelf?.header?.title) || null,
    items: parsedItems.map((p) => p.value),
  };

  return { section, collected: parsedItems };
}

function extractSearchSections(root: any): { sections: MusicSearchSection[]; collected: ParsedItem[] } {
  logKeys("root_keys", root || {});
  const contents = root?.contents;
  if (contents) logKeys("contents_keys", contents);
  const tabbed = contents?.tabbedSearchResultsRenderer;
  if (tabbed) logKeys("tabbedSearchResultsRenderer_keys", tabbed);

  const sections: MusicSearchSection[] = [];
  const collected: ParsedItem[] = [];

  const tabs = tabbed?.tabs || [];
  tabs.forEach((tab: any, tabIndex: number) => {
    logArrayItem("tabs", tabIndex, tab);
    const tabRenderer = tab?.tabRenderer;
    if (tabRenderer) logKeys(`tabRenderer[${tabIndex}]`, tabRenderer);

    const tabContent = tabRenderer?.content;
    if (tabContent) logKeys(`tabRenderer.content[${tabIndex}]`, tabContent);

    const sectionList = tabContent?.sectionListRenderer;
    if (sectionList) logKeys(`sectionListRenderer[${tabIndex}]`, sectionList);

    const sectionContents = sectionList?.contents || [];
    sectionContents.forEach((section: any, sectionIndex: number) => {
      logArrayItem(`sectionListRenderer.contents[${tabIndex}]`, sectionIndex, section);

      if (section?.musicShelfRenderer) {
        const parsed = parseShelfRenderer(section.musicShelfRenderer);
        if (parsed.section) sections.push(parsed.section);
        collected.push(...parsed.collected);
      }

      if (section?.musicCarouselShelfRenderer) {
        const parsed = parseCarouselRenderer(section.musicCarouselShelfRenderer);
        if (parsed.section) sections.push(parsed.section);
        collected.push(...parsed.collected);
      }

      if (section?.musicCardShelfRenderer) {
        const parsed = parseCardShelfRenderer(section.musicCardShelfRenderer);
        if (parsed.section) sections.push(parsed.section);
        collected.push(...parsed.collected);
      }

      if (section?.itemSectionRenderer) {
        logKeys(`itemSectionRenderer[${tabIndex}-${sectionIndex}]`, section.itemSectionRenderer || {});
        const items = section.itemSectionRenderer?.contents || [];
        items.forEach((inner: any, innerIndex: number) => {
          logArrayItem(`itemSectionRenderer.contents[${tabIndex}-${sectionIndex}]`, innerIndex, inner);

          if (inner?.musicShelfRenderer) {
            const parsed = parseShelfRenderer(inner.musicShelfRenderer);
            if (parsed.section) sections.push(parsed.section);
            collected.push(...parsed.collected);
          }

          if (inner?.musicCarouselShelfRenderer) {
            const parsed = parseCarouselRenderer(inner.musicCarouselShelfRenderer);
            if (parsed.section) sections.push(parsed.section);
            collected.push(...parsed.collected);
          }

          if (inner?.musicCardShelfRenderer) {
            const parsed = parseCardShelfRenderer(inner.musicCardShelfRenderer);
            if (parsed.section) sections.push(parsed.section);
            collected.push(...parsed.collected);
          }

          const responsive = inner?.musicResponsiveListItemRenderer;
          if (responsive) {
            const parsed = parseListItem(responsive);
            if (parsed) {
              collected.push(parsed);
              sections.push({ kind: inferKind([parsed]), title: null, items: [parsed.value] });
            }
          }
        });
      }
    });
  });

  return { sections, collected };
}

export async function musicSearch(queryRaw: string): Promise<MusicSearchResults> {
  const query = normalizeString(queryRaw);
  if (!query) throw new Error("Empty search query");

  const config = await loadConfigOrThrow();

  const payload = buildSearchBody(config, query);
  const json = await callYoutubei<any>(config, "search", payload);
  logKeys("root_keys", json || {});
  const contents = json?.contents;
  if (contents) logKeys("contents_keys", contents);
  const tabbed = contents?.tabbedSearchResultsRenderer;
  if (tabbed) logKeys("tabbedSearchResultsRenderer_keys", tabbed);

  const refinements: string[] = Array.isArray((json as any)?.refinements) ? (json as any).refinements.map((s: any) => String(s)) : [];

  const { sections, collected } = extractSearchSections(json);

  const tracks: MusicSearchTrack[] = [];
  const artists: MusicSearchArtist[] = [];
  const albums: MusicSearchAlbum[] = [];
  const playlists: MusicSearchPlaylist[] = [];

  for (const parsed of collected) {
    if (parsed.variant === "track") tracks.push(parsed.value as MusicSearchTrack);
    else if (parsed.variant === "artist") artists.push(parsed.value as MusicSearchArtist);
    else if (parsed.variant === "album") albums.push(parsed.value as MusicSearchAlbum);
    else if (parsed.variant === "playlist") playlists.push(parsed.value as MusicSearchPlaylist);
  }

  const suggestions: MusicSearchSuggestion[] = [];

  return { tracks, artists, albums, playlists, sections, refinements, suggestions };
}

export async function musicSearchRaw(queryRaw: string): Promise<any> {
  const query = normalizeString(queryRaw);
  if (!query) throw new Error("Empty search query");

  const config = await loadConfigOrThrow();

  const payload = buildSearchBody(config, query);
  const json = await callYoutubei<any>(config, "search", payload);
  logKeys("root_keys", json || {});
  const contents = json?.contents;
  if (contents) logKeys("contents_keys", contents);
  const tabbed = contents?.tabbedSearchResultsRenderer;
  if (tabbed) logKeys("tabbedSearchResultsRenderer_keys", tabbed);
  return json;
}

export type PlaylistBrowse = {
  playlistId: string;
  title: string;
  thumbnailUrl: string | null;
  tracks: Array<{ videoId: string; title: string; artist: string; duration?: string | null; thumbnail?: string | null }>;
};

export async function browseArtistById(browseIdRaw: string): Promise<ArtistBrowse | null> {
  const browseId = normalizeString(browseIdRaw);
  if (!browseId) return null;

  const config = await fetchInnertubeConfig();
  if (!config) return null;

  const browseJson = await callYoutubei<any>(config, "browse", {
    context: buildSearchBody(config, "").context,
    browseId,
  });
  if (!browseJson) return null;

  const result = parseArtistBrowseFromInnertube(browseJson, browseId);

  console.info("[browse/artist] parsed", {
    browseId,
    topSongs: result.topSongs.length,
    albums: result.albums.length,
    playlists: result.playlists.length,
  });

  return result;
}

export async function browsePlaylistById(playlistIdRaw: string): Promise<PlaylistBrowse | null> {
  const playlistId = normalizeString(playlistIdRaw);
  if (!playlistId) return null;

  const upper = playlistId.toUpperCase();
  const browseId = upper.startsWith("VL") || upper.startsWith("MPRE") || upper.startsWith("OLAK") ? playlistId : `VL${playlistId}`;
  const config = await fetchInnertubeConfig();
  if (!config) return null;

  const browseJson = await callYoutubei<any>(config, "browse", {
    context: buildSearchBody(config, "").context,
    browseId,
  });
  if (!browseJson) return null;

  const header = browseJson?.header?.musicDetailHeaderRenderer;
  const title = pickText(header?.title) || playlistId;
  const thumbnailUrl =
    pickThumbnail(header?.thumbnail?.croppedSquareThumbnailRenderer?.thumbnail?.thumbnails) ||
    pickThumbnail(header?.thumbnail?.musicThumbnailRenderer?.thumbnail?.thumbnails) ||
    null;

  const tracks: PlaylistBrowse["tracks"] = [];
  const renderSources = new Set<string>();

  const pushTrack = (track: PlaylistBrowse["tracks"][number], source: string) => {
    if (!track?.videoId || !looksLikeVideoId(track.videoId)) return;
    tracks.push(track);
    renderSources.add(source);
  };

  function parsePanel(panel: any) {
    const videoId = normalizeString(panel?.videoId);
    if (!looksLikeVideoId(videoId)) return;
    const trackTitle = pickText(panel?.title);
    const artist = pickText(panel?.shortBylineText) || pickText(panel?.longBylineText) || "";
    const duration = pickText(panel?.lengthText) || normalizeString((panel?.lengthSeconds as any) ?? "");
    const thumb = pickThumbnail(panel?.thumbnail?.thumbnails);
    if (!trackTitle) return;
    pushTrack({ videoId, title: trackTitle, artist, duration: duration || null, thumbnail: thumb }, "playlistPanelVideoRenderer");
  }

  function parsePlaylistVideo(renderer: any) {
    const videoId = normalizeString(renderer?.videoId);
    if (!looksLikeVideoId(videoId)) return;
    const trackTitle = pickText(renderer?.title);
    const artist = pickText(renderer?.shortBylineText) || pickText(renderer?.longBylineText) || "";
    const duration = pickText(renderer?.lengthText) || normalizeString((renderer?.lengthSeconds as any) ?? "");
    const thumb = pickThumbnail(renderer?.thumbnail?.thumbnails);
    if (!trackTitle) return;
    pushTrack({ videoId, title: trackTitle, artist, duration: duration || null, thumbnail: thumb }, "playlistVideoRenderer");
  }

  function parseResponsive(renderer: any) {
    const playNav = renderer?.overlay?.musicItemThumbnailOverlayRenderer?.content?.musicPlayButtonRenderer?.playNavigationEndpoint || renderer?.navigationEndpoint;
    const videoId = normalizeString(playNav?.watchEndpoint?.videoId);
    if (!looksLikeVideoId(videoId)) return;
    const titleText = pickText(renderer?.flexColumns?.[0]?.musicResponsiveListItemFlexColumnRenderer?.text?.runs?.[0]);
    const subtitleRuns = renderer?.flexColumns?.[1]?.musicResponsiveListItemFlexColumnRenderer?.text?.runs;
    const artistText = Array.isArray(subtitleRuns) ? subtitleRuns.map((r: any) => r?.text ?? "").join("") : "";
    const durationText = pickText(renderer?.fixedColumns?.[0]?.musicResponsiveListItemFixedColumnRenderer?.text?.runs?.[0]);
    const thumb = pickThumbnail(renderer?.thumbnail?.musicThumbnailRenderer?.thumbnail?.thumbnails);
    if (!titleText) return;
    pushTrack({ videoId, title: titleText, artist: artistText, duration: durationText || null, thumbnail: thumb }, "musicResponsiveListItemRenderer");
  }

  function walk(node: any): void {
    if (!node) return;
    if (Array.isArray(node)) {
      for (const item of node) walk(item);
      return;
    }
    if (typeof node !== "object") return;

    if ((node as any)?.musicPlaylistShelfRenderer?.contents) {
      const contents = (node as any).musicPlaylistShelfRenderer.contents;
      for (const item of contents || []) {
        if (item?.musicResponsiveListItemRenderer) parseResponsive(item.musicResponsiveListItemRenderer);
        if (item?.playlistPanelVideoRenderer) parsePanel(item.playlistPanelVideoRenderer);
      }
    }

    const panel = (node as any)?.playlistPanelVideoRenderer;
    if (panel) parsePanel(panel);

    const playlistVideo = (node as any)?.playlistVideoRenderer;
    if (playlistVideo) parsePlaylistVideo(playlistVideo);

    const musicShelf = (node as any)?.musicShelfRenderer;
    if (musicShelf?.contents && Array.isArray(musicShelf.contents)) {
      for (const item of musicShelf.contents) {
        if (item?.musicResponsiveListItemRenderer) parseResponsive(item.musicResponsiveListItemRenderer);
        if (item?.playlistPanelVideoRenderer) parsePanel(item.playlistPanelVideoRenderer);
        if (item?.playlistVideoRenderer) parsePlaylistVideo(item.playlistVideoRenderer);
      }
    }

    const responsive = (node as any)?.musicResponsiveListItemRenderer;
    if (responsive) parseResponsive(responsive);

    for (const value of Object.values(node)) walk(value);
  }

  walk(browseJson);

  const deduped: PlaylistBrowse["tracks"] = [];
  const seen = new Set<string>();
  for (const t of tracks) {
    if (seen.has(t.videoId)) continue;
    seen.add(t.videoId);
    deduped.push(t);
  }

  console.info("[browse/playlist] parsed", {
    browseId,
    count: deduped.length,
    sources: Array.from(renderSources),
  });

  return { playlistId, title, thumbnailUrl, tracks: deduped };
}
