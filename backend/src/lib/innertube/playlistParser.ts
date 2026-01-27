type Runs = Array<{ text?: string; navigationEndpoint?: { browseEndpoint?: { browseId?: string } } }> | undefined;

type ThumbnailCandidate = { url?: string | null; width?: number; height?: number };

const VIDEO_ID_REGEX = /^[A-Za-z0-9_-]{11}$/;

const normalizeString = (value: unknown): string => (typeof value === "string" ? value.trim() : "");

const textOrNull = (value: unknown): string | null => {
  const text = normalizeString(value);
  return text ? text : null;
};

const ensureVideoId = (value: unknown): string | null => {
  const candidate = normalizeString(value);
  return VIDEO_ID_REGEX.test(candidate) ? candidate : null;
};

const pickBestThumbnail = (thumbnails?: any): string | null => {
  const arr = Array.isArray(thumbnails) ? thumbnails : thumbnails?.thumbnails;
  if (!Array.isArray(arr) || !arr.length) return null;
  const sorted = [...arr].sort((a: ThumbnailCandidate, b: ThumbnailCandidate) => (b?.width || 0) - (a?.width || 0));
  const best = sorted[0];
  return textOrNull(best?.url);
};

const startsWithUc = (browseId: string | null | undefined): boolean => typeof browseId === "string" && browseId.startsWith("UC");

const extractHeaderTitle = (data: any): string | null => {
  const microTitle = textOrNull(data?.microformat?.microformatDataRenderer?.title);
  if (microTitle) return microTitle;
  return textOrNull(data?.header?.musicDetailHeaderRenderer?.title?.runs?.[0]?.text);
};

const extractHeaderThumbnail = (data: any): string | null => {
  const thumb = pickBestThumbnail(
    data?.header?.musicDetailHeaderRenderer?.thumbnail?.croppedSquareThumbnailRenderer?.thumbnail?.thumbnails,
  );
  if (thumb) return thumb;
  return pickBestThumbnail(data?.microformat?.microformatDataRenderer?.thumbnail?.thumbnails);
};

const extractHeaderArtist = (data: any): string | null => {
  const runs: Runs = data?.header?.musicDetailHeaderRenderer?.subtitle?.runs;
  if (!Array.isArray(runs)) return null;
  for (const run of runs) {
    const browseId = normalizeString(run?.navigationEndpoint?.browseEndpoint?.browseId);
    if (!startsWithUc(browseId)) continue;
    const name = textOrNull(run?.text);
    if (name) return name;
  }
  for (const run of runs) {
    const name = textOrNull(run?.text);
    if (name) return name;
  }
  return null;
};

const parseDuration = (raw: string | number | null | undefined): string | null => {
  const value = raw === null || raw === undefined ? "" : String(raw).trim();
  if (!value) return null;
  if (/^\d+$/.test(value)) {
    const total = Number.parseInt(value, 10);
    if (!Number.isFinite(total) || total < 0) return null;
    const hrs = Math.floor(total / 3600);
    const mins = Math.floor((total % 3600) / 60);
    const secs = total % 60;
    return hrs > 0 ? `${hrs}:${mins.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}` : `${mins}:${secs.toString().padStart(2, "0")}`;
  }
  if (value.includes(":")) {
    const parts = value.split(":").map((p) => Number.parseInt(p.trim(), 10)).filter((n) => Number.isFinite(n) && n >= 0);
    if (!parts.length) return null;
    const total = parts.reduce((acc, cur) => acc * 60 + cur, 0);
    const hrs = Math.floor(total / 3600);
    const mins = Math.floor((total % 3600) / 60);
    const secs = total % 60;
    return hrs > 0 ? `${hrs}:${mins.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}` : `${mins}:${secs.toString().padStart(2, "0")}`;
  }
  return null;
};

const extractDuration = (renderer: any): string | null => {
  return (
    parseDuration(renderer?.fixedColumns?.[0]?.musicResponsiveListItemFixedColumnRenderer?.text?.runs?.[0]?.text) ||
    parseDuration(renderer?.fixedColumns?.[0]?.musicResponsiveListItemFixedColumnRenderer?.text?.simpleText) ||
    parseDuration(renderer?.lengthText?.runs?.[0]?.text) ||
    parseDuration(renderer?.lengthText?.simpleText) ||
    parseDuration(renderer?.lengthSeconds) ||
    parseDuration(renderer?.videoInfo?.lengthSeconds)
  );
};

const extractTitleFromRuns = (node: any): string | null => {
  const runs: Runs = node?.runs;
  if (!Array.isArray(runs)) return textOrNull(node?.simpleText);
  for (const run of runs) {
    const t = textOrNull(run?.text);
    if (t) return t;
  }
  return null;
};

const extractTitle = (renderer: any): string | null => {
  return (
    extractTitleFromRuns(renderer?.title) ||
    extractTitleFromRuns(renderer?.headline) ||
    extractTitleFromRuns(renderer?.flexColumns?.[0]?.musicResponsiveListItemFlexColumnRenderer?.text) ||
    extractTitleFromRuns(renderer?.videoTitle) ||
    textOrNull(renderer?.title)
  );
};

const extractArtist = (renderer: any, fallbackArtist: string | null): string | null => {
  const bylines: Runs[] = [
    renderer?.longBylineText?.runs,
    renderer?.shortBylineText?.runs,
    renderer?.flexColumns?.[1]?.musicResponsiveListItemFlexColumnRenderer?.text?.runs,
    renderer?.subtitle?.runs,
  ];

  for (const candidate of bylines) {
    if (!Array.isArray(candidate)) continue;
    for (const run of candidate) {
      const name = textOrNull(run?.text);
      if (name) return name;
    }
  }

  return fallbackArtist;
};

const extractThumbnail = (renderer: any, fallbackThumb: string | null): string | null => {
  return (
    pickBestThumbnail(renderer?.thumbnail?.musicThumbnailRenderer?.thumbnail?.thumbnails) ||
    pickBestThumbnail(renderer?.thumbnail?.thumbnails) ||
    pickBestThumbnail(renderer?.thumbnailRenderer?.musicThumbnailRenderer?.thumbnail?.thumbnails) ||
    fallbackThumb
  );
};

const extractVideoIdFromRenderer = (renderer: any): string | null => {
  const candidates = [
    renderer?.videoId,
    renderer?.playlistVideoRenderer?.videoId,
    renderer?.navigationEndpoint?.watchEndpoint?.videoId,
    renderer?.navigationEndpoint?.watchPlaylistEndpoint?.videoId,
    renderer?.playNavigationEndpoint?.watchEndpoint?.videoId,
    renderer?.playlistPanelVideoRenderer?.videoId,
  ];

  for (const candidate of candidates) {
    const resolved = ensureVideoId(candidate);
    if (resolved) return resolved;
  }

  return null;
};

const extractTrackFromRenderer = (renderer: any, kind: string, fallbackArtist: string | null, fallbackThumb: string | null) => {
  const videoId = extractVideoIdFromRenderer(renderer);
  if (!videoId) return null;

  const title = extractTitle(renderer);
  const artist = extractArtist(renderer, fallbackArtist);
  const duration = extractDuration(renderer);
  const thumbnail = extractThumbnail(renderer, fallbackThumb);

  return { videoId, title, artist, duration, thumbnail, kind } as ParsedTrack & { kind: string };
};

const collectRenderers = (data: any): Array<{ kind: string; node: any }> => {
  const found: Array<{ kind: string; node: any }> = [];
  const stack: Array<{ value: any; path: string }> = [{ value: data, path: "$" }];

  const pushIf = (kind: string, node: any) => {
    if (node) found.push({ kind, node });
  };

  while (stack.length) {
    const { value } = stack.pop() as { value: any; path: string };
    if (!value) continue;
    if (Array.isArray(value)) {
      value.forEach((child) => stack.push({ value: child, path: "" }));
      continue;
    }
    if (typeof value !== "object") continue;

    const mri = (value as any).musicResponsiveListItemRenderer;
    if (mri) pushIf("musicResponsiveListItemRenderer", mri);

    const ppvr = (value as any).playlistPanelVideoRenderer;
    if (ppvr) pushIf("playlistPanelVideoRenderer", ppvr);

    const pvr = (value as any).playlistVideoRenderer;
    if (pvr) pushIf("playlistVideoRenderer", pvr);

    const videoRenderer = (value as any).videoRenderer;
    if (videoRenderer) pushIf("videoRenderer", videoRenderer);

    Object.values(value).forEach((child) => stack.push({ value: child, path: "" }));
  }

  return found;
};

const computeRendererCounts = (renderers: Array<{ kind: string }>): Record<string, number> => {
  const counts: Record<string, number> = {};
  renderers.forEach((r) => {
    counts[r.kind] = (counts[r.kind] || 0) + 1;
  });
  return counts;
};

export type ParserDiagnostics = {
  rendererCounts: Record<string, number>;
  sampleRendererKinds: string[];
};

export type ParsedTrack = {
  videoId: string | null;
  title: string | null;
  artist: string | null;
  duration: string | null;
  thumbnail: string | null;
};

export type ParsedPlaylist = {
  id: string;
  title: string | null;
  thumbnail: string | null;
  tracks: ParsedTrack[];
  trackCount: number;
};

export type PlaylistParseResult = {
  playlist: ParsedPlaylist;
  diagnostics: ParserDiagnostics;
};

function dedupeTracks(tracks: Array<ParsedTrack & { kind?: string }>): ParsedTrack[] {
  const best = new Map<string, ParsedTrack & { score: number }>();

  tracks.forEach((track) => {
    const videoId = track.videoId || "";
    if (!videoId) return;
    const score = [track.title, track.artist, track.duration, track.thumbnail].filter((v) => Boolean(normalizeString(v))).length;
    const current = best.get(videoId);
    if (!current || score > current.score) {
      best.set(videoId, { ...track, score });
    }
  });

  return Array.from(best.values()).map(({ score: _score, ...rest }) => rest);
}

export function parsePlaylistFromInnertubeWithDiagnostics(browseJson: any, browseId: string): PlaylistParseResult {
  const title = extractHeaderTitle(browseJson);
  const albumArtist = extractHeaderArtist(browseJson);
  const thumbnail = extractHeaderThumbnail(browseJson);

  const renderers = collectRenderers(browseJson);
  const rendererCounts = computeRendererCounts(renderers);

  const tracks = renderers
    .map((item) => extractTrackFromRenderer(item.node, item.kind, albumArtist, thumbnail))
    .filter(Boolean) as Array<ParsedTrack & { kind: string }>;

  const deduped = dedupeTracks(tracks);

  const diagnostics: ParserDiagnostics = {
    rendererCounts,
    sampleRendererKinds: Object.keys(rendererCounts).slice(0, 5),
  };

  return {
    playlist: {
      id: browseId,
      title,
      thumbnail,
      tracks: deduped,
      trackCount: deduped.length,
    },
    diagnostics,
  };
}

export function parsePlaylistFromInnertube(browseJson: any, browseId: string): ParsedPlaylist {
  const { playlist } = parsePlaylistFromInnertubeWithDiagnostics(browseJson, browseId);
  return playlist;
}
