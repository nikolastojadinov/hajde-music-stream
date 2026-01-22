export type ArtistBrowse = {
  artist: {
    name: string;
    channelId: string | null;
    thumbnailUrl: string | null;
    bannerUrl: string | null;
  };
  description: string | null;
  topSongs: Array<{ id: string; title: string; imageUrl: string | null; playCount: string | null }>;
  albums: Array<{ id: string; title: string; imageUrl: string | null; year: string | null }>;
  playlists: Array<{ id: string; title: string; imageUrl: string | null }>;
};

type Song = ArtistBrowse["topSongs"][number];
type Album = ArtistBrowse["albums"][number];
type Playlist = ArtistBrowse["playlists"][number];

type Collection = { album?: Album; playlist?: Playlist };

type WalkPredicate = (value: any) => boolean;

type WalkVisitor = (node: any) => void;

const VIDEO_ID_REGEX = /^[A-Za-z0-9_-]{11}$/;
const CHANNEL_ID_REGEX = /^UC[A-Za-z0-9_-]+$/;

function normalizeString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function looksLikeVideoId(value: unknown): value is string {
  const v = normalizeString(value);
  return VIDEO_ID_REGEX.test(v);
}

function looksLikeChannelId(value: unknown): value is string {
  const v = normalizeString(value);
  return CHANNEL_ID_REGEX.test(v);
}

function pickTextAny(node: any): string {
  if (!node) return "";
  if (typeof node === "string") return normalizeString(node);
  if (Array.isArray(node)) {
    for (const part of node) {
      const text = pickTextAny(part);
      if (text) return text;
    }
    return "";
  }

  const runs = node.runs;
  if (Array.isArray(runs)) {
    const text = runs.map((r: any) => normalizeString(r?.text ?? "")).join("");
    if (text) return text;
  }

  const simple = normalizeString(node.simpleText);
  if (simple) return simple;

  const textField = normalizeString(node.text);
  if (textField) return textField;

  const title = pickTextAny(node.title);
  if (title) return title;

  const name = pickTextAny(node.name);
  if (name) return name;

  return "";
}

function pickFirstText(...nodes: any[]): string {
  for (const node of nodes) {
    const text = pickTextAny(node);
    if (text) return text;
  }
  return "";
}

function pickThumbnailAny(node: any): string | null {
  if (!node) return null;

  const candidates: any[][] = [];

  if (Array.isArray(node)) candidates.push(node);
  if (Array.isArray(node?.thumbnails)) candidates.push(node.thumbnails);
  if (Array.isArray(node?.thumbnail)) candidates.push(node.thumbnail);

  const musicThumb = node?.musicThumbnailRenderer?.thumbnail?.thumbnails;
  if (Array.isArray(musicThumb)) candidates.push(musicThumb);

  const directThumbs = node?.thumbnailRenderer?.musicThumbnailRenderer?.thumbnail?.thumbnails;
  if (Array.isArray(directThumbs)) candidates.push(directThumbs);

  for (const arr of candidates) {
    for (const t of arr) {
      const url = normalizeString(t?.url);
      if (url) return url;
    }
  }

  return null;
}

function deepFind(node: any, predicate: WalkPredicate): any | null {
  if (node === null || node === undefined) return null;
  if (predicate(node)) return node;

  if (Array.isArray(node)) {
    for (const item of node) {
      const found = deepFind(item, predicate);
      if (found) return found;
    }
    return null;
  }

  if (typeof node !== "object") return null;

  for (const value of Object.values(node)) {
    const found = deepFind(value, predicate);
    if (found) return found;
  }

  return null;
}

function extractOwnerChannelId(root: any): string {
  const ownerNode = deepFind(root, (value: any) => {
    const browseId = normalizeString(value?.navigationEndpoint?.browseEndpoint?.browseId);
    if (!looksLikeChannelId(browseId)) return false;

    const pageType = value?.navigationEndpoint?.browseEndpoint?.browseEndpointContextSupportedConfigs?.browseEndpointContextMusicConfig?.pageType;
    if (typeof pageType === "string" && pageType.includes("MUSIC_PAGE_TYPE_ARTIST")) return true;

    return true;
  });

  const browseId = normalizeString(ownerNode?.navigationEndpoint?.browseEndpoint?.browseId);
  return looksLikeChannelId(browseId) ? browseId : "";
}

function extractDescriptionFromShelf(root: any): string {
  const node = deepFind(root, (value: any) => Boolean(value?.musicDescriptionShelfRenderer?.description?.runs));
  if (!node) return "";
  const renderer = (node as any).musicDescriptionShelfRenderer ?? node;
  return runsToDescriptionText(renderer?.description?.runs);
}

function extractDescriptionFromHeader(root: any): string {
  return runsToDescriptionText(root?.header?.musicImmersiveHeaderRenderer?.description?.runs);
}

function extractArtistDescription(root: any): string | null {
  const fromShelf = extractDescriptionFromShelf(root);
  if (fromShelf) return fromShelf;
  const fromHeader = extractDescriptionFromHeader(root);
  return fromHeader || null;
}

function runsToDescriptionText(runs: any): string {
  if (!Array.isArray(runs) || runs.length === 0) return "";
  const text = runs
    .map((r: any) => normalizeString(r?.text ?? ""))
    .filter(Boolean)
    .join(" ");
  return text.replace(/\s+/g, " ").trim();
}

function walkAll(root: any, visitor: WalkVisitor): void {
  if (root === null || root === undefined) return;
  if (Array.isArray(root)) {
    for (const item of root) walkAll(item, visitor);
    return;
  }
  if (typeof root !== "object") return;
  visitor(root);
  for (const value of Object.values(root)) walkAll(value, visitor);
}

function pickYear(text: string | null): string | null {
  if (!text) return null;
  const match = text.match(/(19|20)\d{2}/);
  return match ? match[0] : null;
}

function extractPlayCountFromText(text: string): string | null {
  if (!text) return null;
  const normalized = text.replace(/\s+/g, " ").trim();
  const tagged = normalized.match(/([0-9][0-9., ]*)(?=\s*(plays?|play|pregleda|pregled[a-z]*|reproducciones|reproduccion|reproducao|reproducoes|streams?))/i);
  if (tagged && normalizeString(tagged[1])) return normalizeString(tagged[1]);
  const loose = normalized.match(/([0-9][0-9., ]{2,})/);
  if (loose && normalizeString(loose[1])) return normalizeString(loose[1]);
  return null;
}

function extractPlayCount(renderer: any): string | null {
  const fixed = pickTextAny(renderer?.fixedColumns?.[0]?.musicResponsiveListItemFixedColumnRenderer?.text);
  if (fixed) return fixed;

  const subtitles = [renderer?.subtitle, renderer?.flexColumns?.[1]?.musicResponsiveListItemFlexColumnRenderer?.text];
  for (const node of subtitles) {
    const text = pickTextAny(node);
    const playCount = extractPlayCountFromText(text);
    if (playCount) return playCount;
  }

  return null;
}

function extractVideoId(renderer: any): string | null {
  const direct = normalizeString(
    renderer?.overlay?.musicItemThumbnailOverlayRenderer?.content?.musicPlayButtonRenderer?.playNavigationEndpoint?.watchEndpoint?.videoId ||
      renderer?.navigationEndpoint?.watchEndpoint?.videoId ||
      renderer?.playNavigationEndpoint?.watchEndpoint?.videoId ||
      renderer?.watchEndpoint?.videoId ||
      renderer?.videoId
  );
  if (looksLikeVideoId(direct)) return direct;

  const found = deepFind(renderer, (value: any) => looksLikeVideoId(value?.watchEndpoint?.videoId));
  const nestedId = normalizeString(found?.watchEndpoint?.videoId);
  if (looksLikeVideoId(nestedId)) return nestedId;

  return null;
}

function isAlbumId(id: string, pageType?: string | null): boolean {
  const upper = normalizeString(id).toUpperCase();
  return upper.startsWith("MPRE") || (typeof pageType === "string" && pageType.includes("MUSIC_PAGE_TYPE_ALBUM"));
}

function isPlaylistId(id: string, pageType?: string | null): boolean {
  const upper = normalizeString(id).toUpperCase();
  return upper.startsWith("VL") || upper.startsWith("PL") || (typeof pageType === "string" && pageType.includes("MUSIC_PAGE_TYPE_PLAYLIST"));
}

function parseSongFromResponsive(renderer: any): Song | null {
  const videoId = extractVideoId(renderer);
  if (!videoId) return null;

  const title = pickFirstText(
    renderer?.title,
    renderer?.flexColumns?.[0]?.musicResponsiveListItemFlexColumnRenderer?.text,
    renderer?.overlay?.musicItemThumbnailOverlayRenderer?.content?.musicPlayButtonRenderer?.accessibilityLabel,
    renderer?.navigationEndpoint?.watchEndpoint?.title
  );
  if (!title) return null;

  const imageUrl =
    pickThumbnailAny(renderer?.thumbnail?.musicThumbnailRenderer?.thumbnail) ||
    pickThumbnailAny(renderer?.thumbnailRenderer?.musicThumbnailRenderer?.thumbnail) ||
    pickThumbnailAny(renderer?.thumbnail) ||
    null;

  const playCount = extractPlayCount(renderer);

  return { id: videoId, title, imageUrl, playCount };
}

function parseSongFromPanel(panel: any): Song | null {
  const videoId = extractVideoId(panel);
  if (!videoId) return null;

  const title = pickFirstText(panel?.title, panel?.shortBylineText, panel?.longBylineText);
  if (!title) return null;

  const imageUrl = pickThumbnailAny(panel?.thumbnail) || null;
  const playCount = extractPlayCountFromText(pickTextAny(panel?.subtitle) || pickTextAny(panel?.shortBylineText));

  return { id: videoId, title, imageUrl, playCount };
}

function parseSongFromPlaylistVideo(renderer: any): Song | null {
  const videoId = extractVideoId(renderer);
  if (!videoId) return null;

  const title = pickFirstText(renderer?.title, renderer?.shortBylineText, renderer?.longBylineText);
  if (!title) return null;

  const imageUrl = pickThumbnailAny(renderer?.thumbnail) || null;
  const playCount = extractPlayCountFromText(pickTextAny(renderer?.shortBylineText) || pickTextAny(renderer?.subtitle));

  return { id: videoId, title, imageUrl, playCount };
}

function parseAlbumOrPlaylistFromTwoRow(renderer: any): Collection | null {
  const browseEndpoint = renderer?.navigationEndpoint?.browseEndpoint;
  const browseId = normalizeString(browseEndpoint?.browseId);
  if (!browseId) return null;

  const pageType = browseEndpoint?.browseEndpointContextSupportedConfigs?.browseEndpointContextMusicConfig?.pageType;
  const title = pickTextAny(renderer?.title);
  const imageUrl =
    pickThumbnailAny(renderer?.thumbnailRenderer?.musicThumbnailRenderer?.thumbnail) ||
    pickThumbnailAny(renderer?.thumbnail?.musicThumbnailRenderer?.thumbnail) ||
    pickThumbnailAny(renderer?.thumbnail) ||
    null;
  const subtitle = pickTextAny(renderer?.subtitle) || pickTextAny(renderer?.secondSubtitle) || pickTextAny(renderer?.subtitleText);
  const year = pickYear(subtitle);

  if (isAlbumId(browseId, pageType) && title) return { album: { id: browseId, title, imageUrl, year } };
  if (isPlaylistId(browseId, pageType) && title) return { playlist: { id: browseId, title, imageUrl } };

  return null;
}

function parseAlbumOrPlaylistFromResponsiveIfClearlyCollection(renderer: any): Collection | null {
  const browseEndpoint = renderer?.navigationEndpoint?.browseEndpoint;
  const browseId = normalizeString(browseEndpoint?.browseId);
  if (!browseId) return null;

  const pageType = browseEndpoint?.browseEndpointContextSupportedConfigs?.browseEndpointContextMusicConfig?.pageType;
  const title = pickFirstText(renderer?.title, renderer?.flexColumns?.[0]?.musicResponsiveListItemFlexColumnRenderer?.text);
  const imageUrl =
    pickThumbnailAny(renderer?.thumbnailRenderer?.musicThumbnailRenderer?.thumbnail) ||
    pickThumbnailAny(renderer?.thumbnail?.musicThumbnailRenderer?.thumbnail) ||
    pickThumbnailAny(renderer?.thumbnail) ||
    null;
  const subtitle = pickTextAny(renderer?.subtitle) || pickTextAny(renderer?.flexColumns?.[1]?.musicResponsiveListItemFlexColumnRenderer?.text);
  const year = pickYear(subtitle);

  if (isAlbumId(browseId, pageType) && title) return { album: { id: browseId, title, imageUrl, year } };
  if (isPlaylistId(browseId, pageType) && title) return { playlist: { id: browseId, title, imageUrl } };

  return null;
}

function dedupeByKey<T>(items: T[], keyFn: (item: T) => string): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const item of items) {
    const key = normalizeString(keyFn(item));
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }
  return out;
}

export function parseArtistBrowseFromInnertube(browseJson: any, browseIdRaw: string): ArtistBrowse {
  const browseId = normalizeString(browseIdRaw);
  const ownerChannelId = extractOwnerChannelId(browseJson);
  const channelId = looksLikeChannelId(browseId) ? browseId : ownerChannelId;

  const header = browseJson?.header?.musicImmersiveHeaderRenderer || browseJson?.header?.musicHeaderRenderer;
  const artistName = pickTextAny(header?.title) || browseId;
  const thumbnailUrl =
    pickThumbnailAny(header?.thumbnail?.musicThumbnailRenderer?.thumbnail) || pickThumbnailAny(header?.thumbnail) || null;
  const bannerUrl = pickThumbnailAny(header?.banner?.thumbnails) || null;

  const tabs = Array.isArray(browseJson?.contents?.singleColumnBrowseResultsRenderer?.tabs)
    ? browseJson.contents.singleColumnBrowseResultsRenderer.tabs
    : [];

  const songCandidates: Song[] = [];
  walkAll(tabs, (node: any) => {
    if (node?.musicResponsiveListItemRenderer) {
      const song = parseSongFromResponsive(node.musicResponsiveListItemRenderer);
      if (song) songCandidates.push(song);
    }
    if (node?.playlistPanelVideoRenderer) {
      const song = parseSongFromPanel(node.playlistPanelVideoRenderer);
      if (song) songCandidates.push(song);
    }
    if (node?.playlistVideoRenderer) {
      const song = parseSongFromPlaylistVideo(node.playlistVideoRenderer);
      if (song) songCandidates.push(song);
    }
  });

  const albumCandidates: Album[] = [];
  const playlistCandidates: Playlist[] = [];
  walkAll(tabs, (node: any) => {
    if (node?.musicTwoRowItemRenderer) {
      const parsed = parseAlbumOrPlaylistFromTwoRow(node.musicTwoRowItemRenderer);
      if (parsed?.album) albumCandidates.push(parsed.album);
      if (parsed?.playlist) playlistCandidates.push(parsed.playlist);
    }
    if (node?.musicResponsiveListItemRenderer) {
      const parsed = parseAlbumOrPlaylistFromResponsiveIfClearlyCollection(node.musicResponsiveListItemRenderer);
      if (parsed?.album) albumCandidates.push(parsed.album);
      if (parsed?.playlist) playlistCandidates.push(parsed.playlist);
    }
  });

  const topSongs = dedupeByKey(songCandidates, (item) => item.id).slice(0, 10);
  const albums = dedupeByKey(albumCandidates, (item) => item.id);
  const playlists = dedupeByKey(playlistCandidates, (item) => item.id);
  const description = extractArtistDescription(browseJson);

  return {
    artist: {
      name: artistName,
      channelId: channelId || browseId || null,
      thumbnailUrl,
      bannerUrl,
    },
    description,
    topSongs,
    albums,
    playlists,
  };
}
