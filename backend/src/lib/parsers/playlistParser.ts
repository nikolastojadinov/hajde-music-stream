type Runs = Array<{ text?: string }> | undefined;

type MenuNavigationItem = {
  text?: { runs?: Runs };
  accessibility?: { accessibilityData?: { label?: string } };
  navigationEndpoint?: { browseEndpoint?: { browseId?: string } };
};

type MusicResponsiveListItem = any;

export type PlaylistTrack = {
  title: string;
  artist: string;
  duration: string;
  plays?: string;
  videoId: string;
};

export type ParsedPlaylist = {
  title: string;
  artist?: string;
  trackCount: number;
  totalDuration: string;
  tracks: PlaylistTrack[];
};

const VIDEO_ID_REGEX = /^[A-Za-z0-9_-]{11}$/;

function normalizeString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function looksLikeVideoId(value: string): boolean {
  return VIDEO_ID_REGEX.test(normalizeString(value));
}

function pickRunsText(runs: Runs, joiner = " "): string {
  if (!Array.isArray(runs)) return "";
  const parts: string[] = [];
  for (const run of runs) {
    const text = normalizeString(run?.text);
    if (text) parts.push(text);
  }
  return parts.join(joiner).trim();
}

function pickText(node: any): string {
  if (!node) return "";
  if (typeof node === "string") return normalizeString(node);
  if (Array.isArray(node?.runs)) return pickRunsText(node.runs, " ");
  if (typeof node?.simpleText === "string") return normalizeString(node.simpleText);
  return "";
}

function parseArtistFromFlexColumns(renderer: MusicResponsiveListItem): string | null {
  const columns = Array.isArray(renderer?.flexColumns) ? renderer.flexColumns : [];
  const artists: string[] = [];

  columns.forEach((col: any, idx: number) => {
    const text = pickRunsText(col?.musicResponsiveListItemFlexColumnRenderer?.text?.runs, ", ");
    if (!text) return;
    // Only consider non-title columns as artist/byline text.
    if (idx > 0) artists.push(text);
  });

  if (artists.length > 0) return artists.join(", ");
  return null;
}

function parseArtistFromMenu(renderer: MusicResponsiveListItem): string | null {
  const items = renderer?.menu?.menuRenderer?.items;
  if (!Array.isArray(items)) return null;

  for (const item of items) {
    const nav: MenuNavigationItem | undefined = item?.menuNavigationItemRenderer;
    if (!nav) continue;

    const text = pickRunsText(nav.text?.runs, " ").toLowerCase();
    if (!text.includes("go to artist")) continue;

    const labelRaw = normalizeString(nav.accessibility?.accessibilityData?.label);
    const afterArtist = labelRaw.toLowerCase().includes("artist")
      ? normalizeString(labelRaw.split(/artist/i)[1])
      : "";
    const candidate = normalizeString(afterArtist);
    if (candidate) return candidate;
  }

  return null;
}

function parseArtistFromMicroformat(title: string | null): string | null {
  if (!title) return null;
  const lower = title.toLowerCase();
  const idx = lower.lastIndexOf(" by ");
  if (idx === -1) return null;
  const candidate = normalizeString(title.slice(idx + 4));
  return candidate || null;
}

function extractArtist(renderer: MusicResponsiveListItem, microformatTitle: string | null): string {
  const flexArtist = parseArtistFromFlexColumns(renderer);
  if (flexArtist) return flexArtist;

  const menuArtist = parseArtistFromMenu(renderer);
  if (menuArtist) return menuArtist;

  const microArtist = parseArtistFromMicroformat(microformatTitle);
  if (microArtist) return microArtist;

  return "Unknown artist";
}

function extractVideoId(renderer: MusicResponsiveListItem): string {
  // Treat playlistItemData as authoritative when present.
  const playlistData = normalizeString(renderer?.playlistItemData?.videoId);
  if (looksLikeVideoId(playlistData)) return playlistData;

  const overlayNav = renderer?.overlay?.musicItemThumbnailOverlayRenderer?.content?.musicPlayButtonRenderer?.playNavigationEndpoint;
  const nav = overlayNav || renderer?.navigationEndpoint || renderer?.playNavigationEndpoint;

  const direct = normalizeString(nav?.watchEndpoint?.videoId || renderer?.watchEndpoint?.videoId || renderer?.videoId);
  if (looksLikeVideoId(direct)) return direct;

  return "";
}

function extractDuration(renderer: MusicResponsiveListItem): string {
  const fixed = pickRunsText(renderer?.fixedColumns?.[0]?.musicResponsiveListItemFixedColumnRenderer?.text?.runs, " ");
  if (fixed) return fixed;
  const lengthText = pickText(renderer?.lengthText);
  if (lengthText) return lengthText;
  const subtitle = pickRunsText(renderer?.flexColumns?.[1]?.musicResponsiveListItemFlexColumnRenderer?.text?.runs, " ");
  const match = subtitle.match(/\b(\d+:\d+(:\d+)?)/);
  if (match) return match[1];
  return "";
}

function extractPlays(renderer: MusicResponsiveListItem): string | undefined {
  const columns = Array.isArray(renderer?.flexColumns) ? renderer.flexColumns : [];
  for (const col of columns) {
    const text = pickRunsText(col?.musicResponsiveListItemFlexColumnRenderer?.text?.runs, " ");
    if (!text) continue;
    const match = text.match(/([0-9][0-9.,]*\s*[KMB]?)\s*plays?/i);
    if (match) return normalizeString(match[0]);
  }
  return undefined;
}

function parseTrack(renderer: MusicResponsiveListItem, microformatTitle: string | null): PlaylistTrack | null {
  const videoId = extractVideoId(renderer);
  if (!looksLikeVideoId(videoId)) return null;

  const title =
    pickRunsText(renderer?.flexColumns?.[0]?.musicResponsiveListItemFlexColumnRenderer?.text?.runs, " ") ||
    pickText(renderer?.title);
  if (!title) return null;

  const artist = extractArtist(renderer, microformatTitle);
  const duration = extractDuration(renderer);
  const plays = extractPlays(renderer);

  return { title, artist, duration, plays, videoId };
}

function parseTrackCountAndDuration(secondSubtitle: any): { trackCount: number; totalDuration: string } {
  const text = pickText(secondSubtitle);
  let trackCount = 0;
  let totalDuration = "";

  if (text) {
    const countMatch = text.match(/(\d+)/);
    if (countMatch) trackCount = Number.parseInt(countMatch[1], 10) || 0;

    const parts = text.split(/[•·]/).map((p) => p.trim()).filter(Boolean);
    const durationPart = parts.find((p) => /hour|minute|min|:\d{2}/i.test(p));
    if (durationPart) totalDuration = durationPart;
  }

  return { trackCount, totalDuration };
}

function collectResponsiveItems(root: any): MusicResponsiveListItem[] {
  const out: MusicResponsiveListItem[] = [];
  const sections =
    root?.contents?.twoColumnBrowseResultsRenderer?.secondaryContents?.sectionListRenderer?.contents ?? [];

  sections.forEach((section: any) => {
    const shelves = section?.musicPlaylistShelfRenderer || section?.musicShelfRenderer;
    const contents = shelves?.contents;
    if (Array.isArray(contents)) {
      contents.forEach((item: any) => {
        if (item?.musicResponsiveListItemRenderer) out.push(item.musicResponsiveListItemRenderer);
        if (item?.playlistVideoRenderer) out.push(item.playlistVideoRenderer);
        if (item?.playlistPanelVideoRenderer) out.push(item.playlistPanelVideoRenderer);
      });
    }
  });

  return out;
}

export function parsePlaylistFromInnertube(browseJson: any): ParsedPlaylist {
  const header = browseJson?.header?.musicDetailHeaderRenderer;
  const playlistTitle = pickText(header?.title) || "";
  const playlistArtist = pickText(header?.subtitle) || undefined;
  const { trackCount, totalDuration } = parseTrackCountAndDuration(header?.secondSubtitle);
  const microformatTitle = normalizeString(browseJson?.microformat?.microformatDataRenderer?.title) || null;

  const items = collectResponsiveItems(browseJson);
  const tracks: PlaylistTrack[] = [];
  const seen = new Set<string>();

  items.forEach((renderer) => {
    const track = parseTrack(renderer, microformatTitle);
    if (!track) return;
    if (seen.has(track.videoId)) return;
    seen.add(track.videoId);
    tracks.push(track);
  });

  return {
    title: playlistTitle,
    artist: playlistArtist,
    trackCount,
    totalDuration,
    tracks,
  };
}
