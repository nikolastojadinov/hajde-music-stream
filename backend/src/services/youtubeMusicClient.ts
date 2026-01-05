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

export type MusicSearchResults = {
  tracks: MusicSearchTrack[];
  artists: MusicSearchArtist[];
  albums: MusicSearchAlbum[];
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

function collectResponsiveItems(root: any): any[] {
  const out: any[] = [];
  function walk(node: any): void {
    if (!node) return;
    if (Array.isArray(node)) {
      for (const item of node) walk(item);
      return;
    }
    if (typeof node !== "object") return;

    if ((node as any).musicResponsiveListItemRenderer) {
      out.push((node as any).musicResponsiveListItemRenderer);
    }
    if ((node as any).musicShelfRenderer) {
      const shelfItems = (node as any).musicShelfRenderer?.contents;
      if (Array.isArray(shelfItems)) {
        for (const item of shelfItems) walk(item);
      }
    }
    if ((node as any).musicCarouselShelfRenderer) {
      const cards = (node as any).musicCarouselShelfRenderer?.contents;
      if (Array.isArray(cards)) {
        for (const card of cards) walk(card);
      }
    }

    for (const value of Object.values(node)) walk(value);
  }
  walk(root);
  return out;
}

function parseListItem(item: any): MusicSearchSuggestion | MusicSearchTrack | MusicSearchArtist | MusicSearchAlbum | null {
  const title = pickText(item?.flexColumns?.[0]?.musicResponsiveListItemFlexColumnRenderer?.text?.runs?.[0]);
  const subtitlesRuns = item?.flexColumns?.[1]?.musicResponsiveListItemFlexColumnRenderer?.text?.runs;
  const subtitle = Array.isArray(subtitlesRuns) ? subtitlesRuns.map((r: any) => r?.text ?? "").join("") : "";

  const navigation = item?.navigationEndpoint || item?.overlay?.musicItemThumbnailOverlayRenderer?.content?.musicPlayButtonRenderer?.playNavigationEndpoint;
  const browseEndpoint = navigation?.browseEndpoint;
  const watchEndpoint = navigation?.watchEndpoint;

  const thumb = pickThumbnail(item?.thumbnail?.musicThumbnailRenderer?.thumbnail?.thumbnails);

  // Song / track
  if (watchEndpoint?.videoId && looksLikeVideoId(watchEndpoint.videoId)) {
    return {
      type: "track",
      id: watchEndpoint.videoId,
      title: title || "Unknown",
      artist: subtitle || "Unknown artist",
      youtubeId: watchEndpoint.videoId,
      imageUrl: thumb || undefined,
    } as MusicSearchTrack;
  }

  const browseId = normalizeString(browseEndpoint?.browseId);
  const pageType = browseEndpoint?.browseEndpointContextSupportedConfigs?.browseEndpointContextMusicConfig?.pageType;

  if (browseId && isMusicPageType(pageType, "MUSIC_PAGE_TYPE_ARTIST")) {
    return {
      type: "artist",
      id: browseId,
      name: title || subtitle || "Artist",
      imageUrl: thumb || undefined,
    } as MusicSearchArtist;
  }

  if (browseId && (isMusicPageType(pageType, "MUSIC_PAGE_TYPE_ALBUM") || isMusicPageType(pageType, "MUSIC_PAGE_TYPE_PLAYLIST"))) {
    return {
      type: "album",
      id: browseId,
      title: title || "Album",
      channelId: null,
      channelTitle: subtitle || null,
      imageUrl: thumb || undefined,
    } as MusicSearchAlbum;
  }

  return null;
}

export async function musicSearch(queryRaw: string): Promise<MusicSearchResults> {
  const query = normalizeString(queryRaw);
  if (!query) return { tracks: [], artists: [], albums: [], suggestions: [] };

  const config = await fetchInnertubeConfig();
  if (!config) return { tracks: [], artists: [], albums: [], suggestions: [] };

  const json = await callYoutubei<any>(config, "search", { query });
  if (!json) return { tracks: [], artists: [], albums: [], suggestions: [] };

  const suggestions: MusicSearchSuggestion[] = Array.isArray((json as any)?.refinements)
    ? (json as any).refinements.map((s: any) => ({ type: "track", id: String(s), name: String(s) }))
    : [];

  const items = collectResponsiveItems(json);
  const tracks: MusicSearchTrack[] = [];
  const artists: MusicSearchArtist[] = [];
  const albums: MusicSearchAlbum[] = [];

  for (const item of items) {
    const parsed = parseListItem(item);
    if (!parsed) continue;
    if ((parsed as any).type === "track") {
      tracks.push(parsed as MusicSearchTrack);
      continue;
    }
    if ((parsed as any).type === "artist") {
      artists.push(parsed as MusicSearchArtist);
      continue;
    }
    if ((parsed as any).type === "album") {
      albums.push(parsed as MusicSearchAlbum);
      continue;
    }
  }

  return { tracks, artists, albums, suggestions };
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
