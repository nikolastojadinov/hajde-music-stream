type Runs = Array<{ text?: string }> | undefined;

type MenuNavigationItem = {
  text?: { runs?: Runs };
  accessibility?: { accessibilityData?: { label?: string } };
  navigationEndpoint?: { browseEndpoint?: { browseId?: string } };
};

type MusicResponsiveListItem = any;

export type PlaylistTrack = {
  title: string;
  artist: string | null;
  duration: string;
  videoId: string;
  thumbnail: string | null;
};

export type ParsedPlaylist = {
  title: string;
  subtitle: string | null;
  thumbnail: string | null;
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

function pickBestThumbnail(thumbnails?: any): string | null {
  const arr = Array.isArray(thumbnails) ? thumbnails : thumbnails?.thumbnails;
  if (!Array.isArray(arr) || arr.length === 0) return null;

  const scored = arr
    .map((t: any) => {
      const url = normalizeString(t?.url);
      if (!url) return null;
      const width = Number(t?.width) || 0;
      const height = Number(t?.height) || 0;
      const score = width > 0 && height > 0 ? width * height : width || height;
      return { url, score };
    })
    .filter(Boolean) as Array<{ url: string; score: number }>;

  if (scored.length === 0) return null;
  scored.sort((a, b) => b.score - a.score);
  return scored[0].url;
}

function parseArtistFromFlexColumns(renderer: MusicResponsiveListItem): string | null {
  const columns = Array.isArray(renderer?.flexColumns) ? renderer.flexColumns : [];
  for (let i = 0; i < columns.length; i += 1) {
    if (i === 0) continue; // first column is the title
    const text = pickRunsText(columns[i]?.musicResponsiveListItemFlexColumnRenderer?.text?.runs, " ");
    if (text) return text;
  }
  return null;
}

function parseArtistFromMenu(renderer: MusicResponsiveListItem): string | null {
  const items = renderer?.menu?.menuRenderer?.items;
  if (!Array.isArray(items)) return null;

  for (const item of items) {
    const nav: MenuNavigationItem | undefined = item?.menuNavigationItemRenderer;
    if (!nav) continue;

    const menuText = pickRunsText(nav.text?.runs, " ");
    if (menuText.toLowerCase() !== "go to artist") continue;

    const candidate = pickRunsText(nav.text?.runs, " ");
    if (candidate) return candidate;
  }

  return null;
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

function parseTrack(renderer: MusicResponsiveListItem): PlaylistTrack | null {
  const videoId = extractVideoId(renderer);
  if (!looksLikeVideoId(videoId)) return null;

  const title =
    pickRunsText(renderer?.flexColumns?.[0]?.musicResponsiveListItemFlexColumnRenderer?.text?.runs, " ") ||
    pickText(renderer?.title);
  if (!title) return null;

  const artistFromFlex = parseArtistFromFlexColumns(renderer);
  const artistFromMenu = artistFromFlex ? null : parseArtistFromMenu(renderer);
  type Runs = Array<{ text?: string; navigationEndpoint?: { browseEndpoint?: { browseId?: string } } }> | undefined;

  export type PlaylistTrack = {
    videoId: string;
    title: string;
    artist: string | null;
    duration: string;
    thumbnail: string | null;
  };

  export type ParsedPlaylist = {
    id: string;
    title: string;
    subtitle: string | null;
    thumbnail: string | null;
    tracks: PlaylistTrack[];
  };

  function normalizeString(value: unknown): string {
    return typeof value === "string" ? value.trim() : "";
  }

  function pickRunsText(runs: Runs, joiner = " "): string {
    if (!Array.isArray(runs) || runs.length === 0) return "";
    const parts: string[] = [];
    runs.forEach((run) => {
      const text = normalizeString(run?.text);
      if (text) parts.push(text);
    });
    return parts.join(joiner).trim();
  }

  function pickBestThumbnail(thumbnails?: any): string | null {
    const arr = Array.isArray(thumbnails) ? thumbnails : thumbnails?.thumbnails;
    if (!Array.isArray(arr) || arr.length === 0) return null;

    const scored = arr
      .map((t: any) => {
        const url = normalizeString(t?.url);
        if (!url) return null;
        const width = Number(t?.width) || 0;
        const height = Number(t?.height) || 0;
        const score = width > 0 && height > 0 ? width * height : width || height;
        return { url, score };
      })
      .filter(Boolean) as Array<{ url: string; score: number }>;

    if (scored.length === 0) return null;
    scored.sort((a, b) => b.score - a.score);
    return scored[0].url;
  }

  function extractPlaylistTitle(root: any): string {
    return normalizeString(
      root?.contents?.twoColumnBrowseResultsRenderer?.secondaryContents?.sectionListRenderer?.contents?.[0]?.musicShelfRenderer?.title?.runs?.[0]?.text
    );
  }

  function extractSubtitle(root: any): string | null {
    const subtitle = pickRunsText(root?.header?.musicDetailHeaderRenderer?.secondSubtitle?.runs);
    return subtitle || null;
  }

  function extractPlaylistThumbnail(root: any): string | null {
    const headerThumb = pickBestThumbnail(
      root?.header?.musicDetailHeaderRenderer?.thumbnail?.croppedSquareThumbnailRenderer?.thumbnail?.thumbnails
    );
    if (headerThumb) return headerThumb;
    const backgroundThumb = pickBestThumbnail(root?.background?.musicThumbnailRenderer?.thumbnail?.thumbnails);
    return backgroundThumb || null;
  }

  function extractArtist(renderer: any): string | null {
    const items = renderer?.menu?.menuRenderer?.items;
    if (!Array.isArray(items)) return null;

    let artistBrowseId: string | null = null;
    for (const item of items) {
      const nav = item?.menuNavigationItemRenderer;
      if (!nav) continue;
      const text = normalizeString(nav?.text?.runs?.[0]?.text);
      if (text !== "Go to artist") continue;
      artistBrowseId = normalizeString(nav?.navigationEndpoint?.browseEndpoint?.browseId);
      if (artistBrowseId) break;
    }

    if (!artistBrowseId) return null;

    const artistRuns = renderer?.flexColumns?.[1]?.musicResponsiveListItemFlexColumnRenderer?.text?.runs;
    if (!Array.isArray(artistRuns)) return null;

    for (const run of artistRuns) {
      const runBrowseId = normalizeString(run?.navigationEndpoint?.browseEndpoint?.browseId);
      if (runBrowseId && runBrowseId === artistBrowseId) {
        const name = normalizeString(run?.text);
        if (name) return name;
      }
    }

    return null;
  }

  function extractThumbnail(renderer: any): string | null {
    const primary = pickBestThumbnail(renderer?.thumbnail?.musicThumbnailRenderer?.thumbnail?.thumbnails);
    if (primary) return primary;
    const overlayLabel = normalizeString(
      renderer?.overlay?.musicItemThumbnailOverlayRenderer?.content?.musicPlayButtonRenderer?.accessibilityPlayData?.accessibilityData?.label
    );
    return overlayLabel || null;
  }

  function extractDuration(renderer: any): string {
    return normalizeString(
      renderer?.fixedColumns?.[0]?.musicResponsiveListItemFixedColumnRenderer?.text?.runs?.[0]?.text
    );
  }

  function parseTrack(renderer: any): PlaylistTrack | null {
    const videoId = normalizeString(renderer?.playlistItemData?.videoId);
    if (!videoId) return null;

    const title = normalizeString(
      renderer?.flexColumns?.[0]?.musicResponsiveListItemFlexColumnRenderer?.text?.runs?.[0]?.text
    );
    if (!title) return null;

    const artist = extractArtist(renderer);
    const duration = extractDuration(renderer);
    const thumbnail = extractThumbnail(renderer);

    return { videoId, title, artist, duration, thumbnail };
  }

  export function parsePlaylistFromInnertube(browseJson: any, browseId: string): ParsedPlaylist {
    const title = extractPlaylistTitle(browseJson) || normalizeString(browseId);
    const subtitle = extractSubtitle(browseJson);
    const thumbnail = extractPlaylistThumbnail(browseJson);

    const contents =
      browseJson?.contents?.twoColumnBrowseResultsRenderer?.secondaryContents?.sectionListRenderer?.contents?.[0]?.musicShelfRenderer?.contents;
    const tracks: PlaylistTrack[] = [];

    if (Array.isArray(contents)) {
      contents.forEach((item: any) => {
        const renderer = item?.musicResponsiveListItemRenderer;
        if (!renderer) return;
        const track = parseTrack(renderer);
        if (track) tracks.push(track);
      });
    }

    return {
      id: normalizeString(browseId),
      title,
      subtitle,
      thumbnail,
      tracks,
    };
  }
