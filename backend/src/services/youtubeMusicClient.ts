import { CONSENT_COOKIES, fetchInnertubeConfig, type InnertubeConfig } from "./youtubeInnertubeConfig";
import { parseArtistBrowseFromInnertube, type ArtistBrowse } from "./ytmArtistParser";

export type { ArtistBrowse } from "./ytmArtistParser";

const YTM_USER_AGENT =
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

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

async function callYoutubei<T = any>(
  config: InnertubeConfig,
  path: string,
  payload: Record<string, any>
): Promise<T> {
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

  return (await response.json()) as T;
}

/* ---------- browsePlaylistById (LOG DODAT OVDE) ---------- */

export type PlaylistBrowse = {
  playlistId: string;
  title: string;
  thumbnailUrl: string | null;
  tracks: Array<{ videoId: string; title: string; artist: string; duration?: string | null; thumbnail?: string | null }>;
};

export async function browsePlaylistById(playlistIdRaw: string): Promise<PlaylistBrowse | null> {
  const playlistId = normalizeString(playlistIdRaw);
  if (!playlistId) return null;

  const upper = playlistId.toUpperCase();
  const browseId =
    upper.startsWith("VL") || upper.startsWith("MPRE") || upper.startsWith("OLAK")
      ? playlistId
      : `VL${playlistId}`;

  const config = await fetchInnertubeConfig();
  if (!config) return null;

  const browseJson = await callYoutubei<any>(config, "browse", {
    context: buildSearchBody(config, "").context,
    browseId,
  });

  /* ===== DEBUG LOG (DODATO) ===== */
  console.log(
    "[YT RAW PLAYLIST BROWSE] root keys:",
    Object.keys(browseJson || {})
  );

  console.log(
    "[YT RAW PLAYLIST BROWSE] contents:",
    JSON.stringify(browseJson?.contents ?? null, null, 2)
  );
  /* ============================== */

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
    const playNav =
      renderer?.overlay?.musicItemThumbnailOverlayRenderer?.content?.musicPlayButtonRenderer?.playNavigationEndpoint ||
      renderer?.navigationEndpoint;
    const videoId =
      normalizeString(playNav?.watchEndpoint?.videoId) ||
      normalizeString(renderer?.playlistItemData?.videoId);
    if (!looksLikeVideoId(videoId)) return;

    const titleText = pickText(
      renderer?.flexColumns?.[0]?.musicResponsiveListItemFlexColumnRenderer?.text?.runs?.[0]
    );
    const subtitleRuns = renderer?.flexColumns?.[1]?.musicResponsiveListItemFlexColumnRenderer?.text?.runs;
    const artistText = Array.isArray(subtitleRuns) ? subtitleRuns.map((r: any) => r?.text ?? "").join("") : "";
    const durationText = pickText(
      renderer?.fixedColumns?.[0]?.musicResponsiveListItemFixedColumnRenderer?.text?.runs?.[0]
    );
    const thumb = pickThumbnail(renderer?.thumbnail?.musicThumbnailRenderer?.thumbnail?.thumbnails);
    if (!titleText) return;

    pushTrack(
      { videoId, title: titleText, artist: artistText, duration: durationText || null, thumbnail: thumb },
      "musicResponsiveListItemRenderer"
    );
  }

  function parsePlaylistItemData(item: any) {
    const videoId = normalizeString(item?.playlistItemData?.videoId);
    if (!looksLikeVideoId(videoId)) return;

    const titleText = pickText(
      item?.flexColumns?.[0]?.musicResponsiveListItemFlexColumnRenderer?.text?.runs?.[0]
    );
    const thumb = pickThumbnail(item?.thumbnail?.musicThumbnailRenderer?.thumbnail?.thumbnails);
    const durationText = pickText(
      item?.fixedColumns?.[0]?.musicResponsiveListItemFixedColumnRenderer?.text?.runs?.[0]
    );
    const subtitleRuns = item?.flexColumns?.[1]?.musicResponsiveListItemFlexColumnRenderer?.text?.runs;
    const artistText = Array.isArray(subtitleRuns) ? subtitleRuns.map((r: any) => r?.text ?? "").join("") : "";
    if (!titleText) return;

    pushTrack(
      { videoId, title: titleText, artist: artistText, duration: durationText || null, thumbnail: thumb },
      "playlistItemData"
    );
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
        if (item?.playlistItemData) parsePlaylistItemData(item);
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
        if (item?.playlistItemData) parsePlaylistItemData(item);
      }
    }

    const responsive = (node as any)?.musicResponsiveListItemRenderer;
    if (responsive) parseResponsive(responsive);

    const playlistItemData = (node as any)?.playlistItemData;
    if (playlistItemData) parsePlaylistItemData(node);

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
