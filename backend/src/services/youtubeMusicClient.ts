import { CONSENT_COOKIES, fetchInnertubeConfig, type InnertubeConfig } from "./youtubeInnertubeConfig";

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
  type: "artist" | "track" | "album";
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
  import { CONSENT_COOKIES, fetchInnertubeConfig, type InnertubeConfig } from "./youtubeInnertubeConfig";

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
    type: "artist" | "track" | "album";
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

  async function callYoutubei<T = any>(config: InnertubeConfig, path: string, payload: Record<string, any>): Promise<T | null> {
    const clientVersion = config.clientVersion || "1.20241210.01.00";
    const url = `https://music.youtube.com/youtubei/v1/${path}?prettyPrint=false&key=${encodeURIComponent(config.apiKey)}`;

    try {
      const response = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
          "Accept-Language": "en-US,en;q=0.9",
          "User-Agent": "Mozilla/5.0 (X11; Linux x86_64) HajdeMusic/1.0",
          Origin: "https://music.youtube.com",
          Referer: "https://music.youtube.com/",
          Cookie: CONSENT_COOKIES,
          "X-Goog-Visitor-Id": config.visitorData || "",
        },
        body: JSON.stringify({
          context: {
            client: {
              clientName: "WEB_REMIX",
              clientVersion,
              hl: "en",
              gl: "US",
              visitorData: config.visitorData || undefined,
            },
            user: { enableSafetyMode: false },
          },
          ...payload,
        }),
      });

      if (!response.ok) return null;
      const json = await response.json().catch(() => null);
      if (!json || typeof json !== "object") return null;
      return json as T;
    } catch {
      return null;
    }
  }

  // Debug logging helpers
  function logKeys(label: string, obj: any): void {
    const keys = obj && typeof obj === "object" ? Object.keys(obj) : [];
    console.log(`[Innertube][${label}]`, keys);
  }

  function logArrayItem(label: string, index: number, obj: any): void {
    const keys = obj && typeof obj === "object" ? Object.keys(obj) : [];
    console.log(`[Innertube][${label}][${index}]`, keys);
  }

  type ParsedItem =
    | { variant: "track"; value: MusicSearchTrack }
    | { variant: "artist"; value: MusicSearchArtist }
    | { variant: "album"; value: MusicSearchAlbum }
    | { variant: "playlist"; value: MusicSearchPlaylist };

  function parseListItem(item: any): ParsedItem | null {
    logKeys("musicResponsiveListItemRenderer", item);

    const title = pickText(item?.flexColumns?.[0]?.musicResponsiveListItemFlexColumnRenderer?.text?.runs?.[0]);
    const subtitlesRuns = item?.flexColumns?.[1]?.musicResponsiveListItemFlexColumnRenderer?.text?.runs;
    const subtitle = Array.isArray(subtitlesRuns) ? subtitlesRuns.map((r: any) => r?.text ?? "").join("") : "";

    const navigation = item?.navigationEndpoint || item?.overlay?.musicItemThumbnailOverlayRenderer?.content?.musicPlayButtonRenderer?.playNavigationEndpoint;
    const browseEndpoint = navigation?.browseEndpoint;
    const watchEndpoint = navigation?.watchEndpoint;

    const thumb = pickThumbnail(item?.thumbnail?.musicThumbnailRenderer?.thumbnail?.thumbnails);

    if (watchEndpoint?.videoId && looksLikeVideoId(watchEndpoint.videoId)) {
      return {
        variant: "track",
        value: {
          id: watchEndpoint.videoId,
          title: title || "Unknown",
          artist: subtitle || "Unknown artist",
          youtubeId: watchEndpoint.videoId,
          imageUrl: thumb || undefined,
        },
      };
    }

    const browseId = normalizeString(browseEndpoint?.browseId);
    const pageType = browseEndpoint?.browseEndpointContextSupportedConfigs?.browseEndpointContextMusicConfig?.pageType;

    if (browseId && isMusicPageType(pageType, "MUSIC_PAGE_TYPE_ARTIST")) {
      return {
        variant: "artist",
        value: {
          id: browseId,
          name: title || subtitle || "Artist",
          imageUrl: thumb || undefined,
        },
      };
    }

    if (browseId && isMusicPageType(pageType, "MUSIC_PAGE_TYPE_ALBUM")) {
      return {
        variant: "album",
        value: {
          id: browseId,
          title: title || "Album",
          channelId: null,
          channelTitle: subtitle || null,
          imageUrl: thumb || undefined,
        },
      };
    }

    if (browseId && isMusicPageType(pageType, "MUSIC_PAGE_TYPE_PLAYLIST")) {
      return {
        variant: "playlist",
        value: {
          id: browseId,
          title: title || "Playlist",
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

    if (!browseId) return null;

    if (isMusicPageType(pageType, "MUSIC_PAGE_TYPE_ALBUM")) {
      return {
        variant: "album",
        value: {
          id: browseId,
          title: title || "Album",
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
          title: title || "Playlist",
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
          name: title || subtitle || "Artist",
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

    contents.forEach((content, idx) => {
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

    cards.forEach((card, idx) => {
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

    contents.forEach((content, idx) => {
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
    logKeys("root", root || {});
    logKeys("contents", root?.contents || {});
    logKeys("tabbedSearchResultsRenderer", root?.contents?.tabbedSearchResultsRenderer || {});

    const sections: MusicSearchSection[] = [];
    const collected: ParsedItem[] = [];

    const tabs = root?.contents?.tabbedSearchResultsRenderer?.tabs || [];
    tabs.forEach((tab: any, tabIndex: number) => {
      logArrayItem("tabs", tabIndex, tab);
      const tabRenderer = tab?.tabRenderer;
      logKeys(`tabRenderer[${tabIndex}]`, tabRenderer || {});

      const tabContent = tabRenderer?.content;
      logKeys(`tabRenderer.content[${tabIndex}]`, tabContent || {});

      const sectionList = tabContent?.sectionListRenderer;
      logKeys(`sectionListRenderer[${tabIndex}]`, sectionList || {});

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

    logKeys("refinements", root?.refinements || {});
    console.log("[Innertube][sections.length]", sections.length);

    if (sections.length === 0) {
      console.error("[Innertube][FATAL] sections is EMPTY – search parsing FAILED");
    }

    return { sections, collected };
  }

  export async function musicSearch(queryRaw: string): Promise<MusicSearchResults> {
    const query = normalizeString(queryRaw);
    if (!query) return { tracks: [], artists: [], albums: [], playlists: [], sections: [], refinements: [], suggestions: [] };

    const config = await fetchInnertubeConfig();
    if (!config) return { tracks: [], artists: [], albums: [], playlists: [], sections: [], refinements: [], suggestions: [] };

    const json = await callYoutubei<any>(config, "search", { query });
    logKeys("root_response", json || {});
    if (!json) return { tracks: [], artists: [], albums: [], playlists: [], sections: [], refinements: [], suggestions: [] };

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

    const suggestions: MusicSearchSuggestion[] = refinements.map((s) => ({ type: "track", id: s, name: s }));

    return { tracks, artists, albums, playlists, sections, refinements, suggestions };
  }

  export type ArtistBrowse = {
    artist: {
      name: string;
      channelId: string | null;
      thumbnailUrl: string | null;
      bannerUrl: string | null;
    };
    topSongs: Array<{ id: string; title: string; youtubeId: string; artist: string; imageUrl?: string }>;
    albums: Array<{ id: string; title: string; imageUrl?: string; channelTitle?: string | null }>;
  };

  function pickFirstArtistBrowseId(results: MusicSearchResults, fallbackQuery: string): { browseId: string | null; title: string } {
    if (results.artists.length > 0) {
      return { browseId: results.artists[0].id, title: results.artists[0].name };
    }
    if (results.tracks.length > 0) {
      return { browseId: results.tracks[0].artist, title: fallbackQuery };
    }
    return { browseId: null, title: fallbackQuery };
  }

  export async function fetchArtistBrowse(queryRaw: string): Promise<ArtistBrowse | null> {
    const searchResults = await musicSearch(queryRaw);
    const { browseId, title } = pickFirstArtistBrowseId(searchResults, queryRaw);
    const candidateBrowseId = browseId && browseId.startsWith("UC") ? browseId : browseId || null;
    if (!candidateBrowseId) return null;

    const config = await fetchInnertubeConfig();
    if (!config) return null;

    const browseJson = await callYoutubei<any>(config, "browse", { browseId: candidateBrowseId });
    if (!browseJson) return null;

    const header = browseJson.header?.musicImmersiveHeaderRenderer || browseJson.header?.musicHeaderRenderer;
    const titleText = pickText(header?.title) || title || "Artist";
    const thumbnailUrl = pickThumbnail(header?.thumbnail?.musicThumbnailRenderer?.thumbnail?.thumbnails) || null;
    const bannerUrl = pickThumbnail(header?.banner?.thumbnails) || null;

    const sections = browseJson?.contents?.singleColumnBrowseResultsRenderer?.tabs?.[0]?.tabRenderer?.content?.sectionListRenderer?.contents || [];

    const topSongs: ArtistBrowse["topSongs"] = [];
    const albums: ArtistBrowse["albums"] = [];

    function collectResponsiveItems(node: any): any[] {
      const out: any[] = [];
      function walk(n: any): void {
        if (!n) return;
        if (Array.isArray(n)) {
          for (const item of n) walk(item);
          return;
        }
        if (typeof n !== "object") return;

        if ((n as any).musicResponsiveListItemRenderer) {
          out.push((n as any).musicResponsiveListItemRenderer);
        }
        if ((n as any).musicShelfRenderer) {
          const shelfItems = (n as any).musicShelfRenderer?.contents;
          if (Array.isArray(shelfItems)) {
            for (const item of shelfItems) walk(item);
          }
        }
        if ((n as any).musicCarouselShelfRenderer) {
          const cards = (n as any).musicCarouselShelfRenderer?.contents;
          if (Array.isArray(cards)) {
            for (const card of cards) walk(card);
          }
        }

        for (const value of Object.values(n)) walk(value);
      }
      walk(node);
      return out;
    }

    function extractSongs(node: any) {
      const items = collectResponsiveItems(node);
      for (const item of items) {
        const nav = item?.navigationEndpoint || item?.overlay?.musicItemThumbnailOverlayRenderer?.content?.musicPlayButtonRenderer?.playNavigationEndpoint;
        const videoId = nav?.watchEndpoint?.videoId;
        if (!looksLikeVideoId(videoId)) continue;
        const songTitle = pickText(item?.flexColumns?.[0]?.musicResponsiveListItemFlexColumnRenderer?.text?.runs?.[0]) || "Track";
        const subtitlesRuns = item?.flexColumns?.[1]?.musicResponsiveListItemFlexColumnRenderer?.text?.runs;
        const artistName = Array.isArray(subtitlesRuns) ? subtitlesRuns.map((r: any) => r?.text ?? "").join("") : titleText;
        topSongs.push({ id: videoId, title: songTitle, youtubeId: videoId, artist: artistName, imageUrl: pickThumbnail(item?.thumbnail?.musicThumbnailRenderer?.thumbnail?.thumbnails) || undefined });
      }
    }

    function extractAlbums(node: any) {
      const carousel = node?.musicCarouselShelfRenderer;
      if (!carousel) return;
      const cards = carousel.contents || [];
      for (const card of cards) {
        const renderer = card?.musicTwoRowItemRenderer;
        if (!renderer) continue;
        const browseIdAlbum = normalizeString(renderer?.navigationEndpoint?.browseEndpoint?.browseId);
        if (!browseIdAlbum) continue;
        const pageType = renderer?.navigationEndpoint?.browseEndpoint?.browseEndpointContextSupportedConfigs?.browseEndpointContextMusicConfig?.pageType;
        if (!isMusicPageType(pageType, "MUSIC_PAGE_TYPE_ALBUM") && !isMusicPageType(pageType, "MUSIC_PAGE_TYPE_PLAYLIST")) continue;
        const albumTitle = pickText(renderer?.title) || "Album";
        const thumb = pickThumbnail(renderer?.thumbnailRenderer?.musicThumbnailRenderer?.thumbnail?.thumbnails) || undefined;
        const subtitleText = pickText(renderer?.subtitle) || null;
        albums.push({ id: browseIdAlbum, title: albumTitle, imageUrl: thumb, channelTitle: subtitleText });
      }
    }

    for (const section of sections) {
      if (section?.musicShelfRenderer) {
        extractSongs(section);
      }
      if (section?.musicCarouselShelfRenderer) {
        extractAlbums(section);
      }
    }

    return {
      artist: {
        name: titleText,
        channelId: candidateBrowseId,
        thumbnailUrl,
        bannerUrl,
      },
      topSongs,
      albums,
    };
  }

  export async function musicSearchRaw(queryRaw: string): Promise<any | null> {
    const query = normalizeString(queryRaw);
    if (!query) return null;

    const config = await fetchInnertubeConfig();
    if (!config) return null;

    return callYoutubei<any>(config, "search", { query });
  }
          }

          const suggestions: MusicSearchSuggestion[] = refinements.map((s) => ({ type: "track", id: s, name: s }));

          return { tracks, artists, albums, playlists, sections, refinements, suggestions };
        }

        export type ArtistBrowse = {
          artist: {
            name: string;
            channelId: string | null;
            thumbnailUrl: string | null;
            bannerUrl: string | null;
          };
          topSongs: Array<{ id: string; title: string; youtubeId: string; artist: string; imageUrl?: string }>;
          albums: Array<{ id: string; title: string; imageUrl?: string; channelTitle?: string | null }>;
        };

        function pickFirstArtistBrowseId(results: MusicSearchResults, fallbackQuery: string): { browseId: string | null; title: string } {
          if (results.artists.length > 0) {
            return { browseId: results.artists[0].id, title: results.artists[0].name };
          }
          if (results.tracks.length > 0) {
            return { browseId: results.tracks[0].artist, title: fallbackQuery };
          }
          return { browseId: null, title: fallbackQuery };
        }

        export async function fetchArtistBrowse(queryRaw: string): Promise<ArtistBrowse | null> {
          const searchResults = await musicSearch(queryRaw);
          const { browseId, title } = pickFirstArtistBrowseId(searchResults, queryRaw);
          const candidateBrowseId = browseId && browseId.startsWith("UC") ? browseId : browseId || null;
          if (!candidateBrowseId) return null;

          const config = await fetchInnertubeConfig();
          if (!config) return null;

          const browseJson = await callYoutubei<any>(config, "browse", { browseId: candidateBrowseId });
          if (!browseJson) return null;

          const header = browseJson.header?.musicImmersiveHeaderRenderer || browseJson.header?.musicHeaderRenderer;
          const titleText = pickText(header?.title) || title || "Artist";
          const thumbnailUrl = pickThumbnail(header?.thumbnail?.musicThumbnailRenderer?.thumbnail?.thumbnails) || null;
          const bannerUrl = pickThumbnail(header?.banner?.thumbnails) || null;

          const sections = browseJson?.contents?.singleColumnBrowseResultsRenderer?.tabs?.[0]?.tabRenderer?.content?.sectionListRenderer?.contents || [];

          const topSongs: ArtistBrowse["topSongs"] = [];
          const albums: ArtistBrowse["albums"] = [];

          function collectResponsiveItems(node: any): any[] {
            const out: any[] = [];
            function walk(n: any): void {
              if (!n) return;
              if (Array.isArray(n)) {
                for (const item of n) walk(item);
                return;
              }
              if (typeof n !== "object") return;

              if ((n as any).musicResponsiveListItemRenderer) {
                out.push((n as any).musicResponsiveListItemRenderer);
              }
              if ((n as any).musicShelfRenderer) {
                const shelfItems = (n as any).musicShelfRenderer?.contents;
                if (Array.isArray(shelfItems)) {
                  for (const item of shelfItems) walk(item);
                }
              }
              if ((n as any).musicCarouselShelfRenderer) {
                const cards = (n as any).musicCarouselShelfRenderer?.contents;
                if (Array.isArray(cards)) {
                  for (const card of cards) walk(card);
                }
              }

              for (const value of Object.values(n)) walk(value);
            }
            walk(node);
            return out;
          }

          function extractSongs(node: any) {
            const items = collectResponsiveItems(node);
            for (const item of items) {
              const nav = item?.navigationEndpoint || item?.overlay?.musicItemThumbnailOverlayRenderer?.content?.musicPlayButtonRenderer?.playNavigationEndpoint;
              const videoId = nav?.watchEndpoint?.videoId;
              if (!looksLikeVideoId(videoId)) continue;
              const songTitle = pickText(item?.flexColumns?.[0]?.musicResponsiveListItemFlexColumnRenderer?.text?.runs?.[0]) || "Track";
              const subtitlesRuns = item?.flexColumns?.[1]?.musicResponsiveListItemFlexColumnRenderer?.text?.runs;
              const artistName = Array.isArray(subtitlesRuns) ? subtitlesRuns.map((r: any) => r?.text ?? "").join("") : titleText;
              topSongs.push({ id: videoId, title: songTitle, youtubeId: videoId, artist: artistName, imageUrl: pickThumbnail(item?.thumbnail?.musicThumbnailRenderer?.thumbnail?.thumbnails) || undefined });
            }
          }

          function extractAlbums(node: any) {
            const carousel = node?.musicCarouselShelfRenderer;
            if (!carousel) return;
            const cards = carousel.contents || [];
            for (const card of cards) {
              const renderer = card?.musicTwoRowItemRenderer;
              if (!renderer) continue;
              const browseIdAlbum = normalizeString(renderer?.navigationEndpoint?.browseEndpoint?.browseId);
              if (!browseIdAlbum) continue;
              const pageType = renderer?.navigationEndpoint?.browseEndpoint?.browseEndpointContextSupportedConfigs?.browseEndpointContextMusicConfig?.pageType;
              if (!isMusicPageType(pageType, "MUSIC_PAGE_TYPE_ALBUM") && !isMusicPageType(pageType, "MUSIC_PAGE_TYPE_PLAYLIST")) continue;
              const albumTitle = pickText(renderer?.title) || "Album";
              const thumb = pickThumbnail(renderer?.thumbnailRenderer?.musicThumbnailRenderer?.thumbnail?.thumbnails) || undefined;
              const subtitleText = pickText(renderer?.subtitle) || null;
              albums.push({ id: browseIdAlbum, title: albumTitle, imageUrl: thumb, channelTitle: subtitleText });
            }
          }

          for (const section of sections) {
            if (section?.musicShelfRenderer) {
              extractSongs(section);
            }
            if (section?.musicCarouselShelfRenderer) {
              extractAlbums(section);
            }
          }

          return {
            artist: {
              name: titleText,
              channelId: candidateBrowseId,
              thumbnailUrl,
              bannerUrl,
            },
            topSongs,
            albums,
          };
        }

        export async function musicSearchRaw(queryRaw: string): Promise<any | null> {
          const query = normalizeString(queryRaw);
          if (!query) return null;

          const config = await fetchInnertubeConfig();
          if (!config) return null;

          return callYoutubei<any>(config, "search", { query });
        }
