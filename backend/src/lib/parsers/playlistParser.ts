type Runs = Array<{ text?: string; navigationEndpoint?: { browseEndpoint?: { browseId?: string } } }> | undefined;

type MenuItem = {
  menuNavigationItemRenderer?: {
    text?: { runs?: Runs };
    navigationEndpoint?: { browseEndpoint?: { browseId?: string } };
  };
};

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
  const items: MenuItem[] | undefined = renderer?.menu?.menuRenderer?.items;
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
  const title = extractPlaylistTitle(browseJson);
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
