// NOTE: This file is intentionally self-contained. Album responses differ from playlists, so we parse them directly.

import type { ParsedTrack } from "./playlistParser";

type Runs = Array<{ text?: string; navigationEndpoint?: { browseEndpoint?: { browseId?: string } } }>;

type ThumbnailCandidate = { url?: string; width?: number; height?: number };

const normalizeString = (value: unknown): string => (typeof value === "string" ? value.trim() : "");

const textOrNull = (value: unknown): string | null => {
  const text = normalizeString(value);
  return text === "" ? null : text;
};

const pickLastThumbnail = (thumbnails?: any): string | null => {
  const arr = Array.isArray(thumbnails) ? thumbnails : thumbnails?.thumbnails;
  if (!Array.isArray(arr) || arr.length === 0) return null;
  const last = arr[arr.length - 1] as ThumbnailCandidate;
  const url = normalizeString(last?.url);
  return url || null;
};

const startsWithUc = (browseId: string | null | undefined): boolean => typeof browseId === "string" && browseId.startsWith("UC");

const collectSubtitleRuns = (data: any): Runs | undefined => {
  if (Array.isArray(data?.header?.musicDetailHeaderRenderer?.subtitle?.runs)) {
    return data.header.musicDetailHeaderRenderer.subtitle.runs as Runs;
  }
  if (Array.isArray(data?.header?.musicDetailHeaderRenderer?.secondSubtitle?.runs)) {
    return data.header.musicDetailHeaderRenderer.secondSubtitle.runs as Runs;
  }
  return undefined;
};

const extractTitle = (data: any): string | null => {
  const microTitle = textOrNull(data?.microformat?.microformatDataRenderer?.title);
  if (microTitle) return microTitle;
  return textOrNull(data?.header?.musicDetailHeaderRenderer?.title?.runs?.[0]?.text);
};

const extractArtist = (data: any): string | null => {
  const runs = collectSubtitleRuns(data);
  if (Array.isArray(runs)) {
    for (const run of runs) {
      const browseId = normalizeString(run?.navigationEndpoint?.browseEndpoint?.browseId);
      if (!startsWithUc(browseId)) continue;
      const name = textOrNull(run?.text);
      if (name) return name;
    }
    for (const run of runs) {
      const name = textOrNull(run?.text);
      if (name && !/^album$/i.test(name)) return name;
    }
  }
  return null;
};

const extractYear = (data: any, subtitleRuns: Runs | undefined): string | null => {
  const subtitleText = Array.isArray(subtitleRuns)
    ? subtitleRuns.map((r) => normalizeString(r?.text)).filter(Boolean).join(" ")
    : "";

  const publishDate = normalizeString(data?.microformat?.microformatDataRenderer?.publishDate);
  const candidateText = subtitleText || publishDate;
  const match = candidateText.match(/\b(20\d{2}|19\d{2})\b/);
  if (match && match[1]) return match[1];
  return null;
};

const extractThumbnail = (data: any): string | null => {
  const headerThumb = pickLastThumbnail(
    data?.header?.musicDetailHeaderRenderer?.thumbnail?.croppedSquareThumbnailRenderer?.thumbnail?.thumbnails,
  );
  if (headerThumb) return headerThumb;
  const backgroundThumb = pickLastThumbnail(data?.background?.musicThumbnailRenderer?.thumbnail?.thumbnails);
  if (backgroundThumb) return backgroundThumb;
  return pickLastThumbnail(data?.microformat?.microformatDataRenderer?.thumbnail?.thumbnails);
};

const extractTrackTitle = (renderer: any): string | null => {
  return textOrNull(renderer?.flexColumns?.[0]?.musicResponsiveListItemFlexColumnRenderer?.text?.runs?.[0]?.text);
};

const extractTrackArtist = (renderer: any, albumArtist: string | null): string | null => {
  const runs: Runs | undefined = renderer?.flexColumns?.[1]?.musicResponsiveListItemFlexColumnRenderer?.text?.runs;
  if (Array.isArray(runs)) {
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
  }
  return albumArtist;
};

const extractDuration = (renderer: any): string | null => {
  return textOrNull(renderer?.fixedColumns?.[0]?.musicResponsiveListItemFixedColumnRenderer?.text?.runs?.[0]?.text);
};

const extractTrackThumbnail = (renderer: any, albumThumbnail: string | null): string | null => {
  const thumb = pickLastThumbnail(renderer?.thumbnail?.musicThumbnailRenderer?.thumbnail?.thumbnails);
  if (thumb) return thumb;
  return albumThumbnail;
};

const extractVideoId = (renderer: any): string | null => {
  const fromPlaylistData = textOrNull(renderer?.playlistItemData?.videoId);
  if (fromPlaylistData) return fromPlaylistData;

  const fromOverlay = textOrNull(
    renderer?.overlay?.musicItemThumbnailOverlayRenderer?.content?.musicPlayButtonRenderer?.playNavigationEndpoint
      ?.watchEndpoint?.videoId,
  );
  if (fromOverlay) return fromOverlay;

  const fromTitleRun = textOrNull(
    renderer?.flexColumns?.[0]?.musicResponsiveListItemFlexColumnRenderer?.text?.runs?.[0]?.navigationEndpoint
      ?.watchEndpoint?.videoId,
  );
  if (fromTitleRun) return fromTitleRun;

  const menuItems = renderer?.menu?.menuRenderer?.items;
  if (Array.isArray(menuItems)) {
    for (const item of menuItems) {
      const vid = textOrNull(
        item?.menuNavigationItemRenderer?.navigationEndpoint?.watchEndpoint?.videoId ||
          item?.menuServiceItemRenderer?.navigationEndpoint?.watchEndpoint?.videoId,
      );
      if (vid) return vid;
    }
  }

  return null;
};

const pickShelfContents = (sections: any): any[] | null => {
  if (!Array.isArray(sections)) return null;
  for (const section of sections) {
    const contents = section?.musicShelfRenderer?.contents;
    if (Array.isArray(contents) && contents.some((c) => c?.musicResponsiveListItemRenderer)) {
      return contents;
    }
  }
  return null;
};

const findTrackItems = (payload: any): any[] => {
  const candidates: Array<any[] | null> = [];

  candidates.push(
    pickShelfContents(payload?.contents?.twoColumnBrowseResultsRenderer?.secondaryContents?.sectionListRenderer?.contents),
  );
  candidates.push(
    pickShelfContents(payload?.contents?.twoColumnBrowseResultsRenderer?.primaryContents?.sectionListRenderer?.contents),
  );

  const tabs = payload?.contents?.singleColumnBrowseResultsRenderer?.tabs;
  if (Array.isArray(tabs)) {
    const tabSections = tabs
      .map((tab: any) => tab?.tabRenderer?.content?.sectionListRenderer?.contents)
      .filter(Array.isArray)
      .flat();
    candidates.push(pickShelfContents(tabSections));
  }

  for (const candidate of candidates) {
    if (Array.isArray(candidate)) {
      return candidate.map((item) => item?.musicResponsiveListItemRenderer).filter(Boolean);
    }
  }

  const shelves: any[][] = [];
  const walk = (node: any) => {
    if (!node || typeof node !== "object") return;
    if (Array.isArray(node)) {
      node.forEach((child) => walk(child));
      return;
    }
    const contents = node?.musicShelfRenderer?.contents;
    if (Array.isArray(contents) && contents.some((c) => c?.musicResponsiveListItemRenderer)) {
      shelves.push(contents);
    }
    for (const value of Object.values(node)) {
      walk(value);
    }
  };
  walk(payload);

  if (shelves.length === 0) return [];
  const [largestShelf] = shelves.sort((a, b) => b.length - a.length);
  return largestShelf.map((item) => item?.musicResponsiveListItemRenderer).filter(Boolean);
};

const parseAlbumTracks = (payload: any, albumArtist: string | null, albumThumbnail: string | null): ParsedTrack[] => {
  const renderers = findTrackItems(payload);
  if (!Array.isArray(renderers)) return [];

  const tracks = renderers
    .map((renderer: any) => {
      const videoId = extractVideoId(renderer);
      const title = extractTrackTitle(renderer);
      const artist = extractTrackArtist(renderer, albumArtist);
      const duration = extractDuration(renderer);
      const thumbnail = extractTrackThumbnail(renderer, albumThumbnail);

      return { videoId, title, artist, duration, thumbnail } as ParsedTrack;
    })
    .filter((track: ParsedTrack) => Boolean(track.videoId));

  const deduped: ParsedTrack[] = [];
  const seen = new Set<string>();
  for (const track of tracks) {
    const vid = track.videoId;
    if (!vid) continue;
    if (seen.has(vid)) continue;
    seen.add(vid);
    deduped.push(track);
  }

  return deduped;
};

export type ParsedAlbum = {
  id: string;
  title: string | null;
  artist: string | null;
  year: string | null;
  thumbnail: string | null;
  tracks: ParsedTrack[];
  trackCount: number;
};

export function parseAlbumFromInnertube(browseJson: any, browseId: string): ParsedAlbum {
  console.log("[albumParser] RAW_KEYS", Object.keys(browseJson || {}));
  console.log("[albumParser] RAW_SAMPLE", JSON.stringify(browseJson ?? {}).slice(0, 2000));

  const title = extractTitle(browseJson);
  const subtitleRuns = collectSubtitleRuns(browseJson);
  const artist = extractArtist(browseJson);
  const year = extractYear(browseJson, subtitleRuns);
  const thumbnail = extractThumbnail(browseJson);
  const tracks = parseAlbumTracks(browseJson, artist, thumbnail);

  return {
    id: browseId,
    title,
    artist,
    year,
    thumbnail,
    tracks,
    trackCount: tracks.length,
  };
}
