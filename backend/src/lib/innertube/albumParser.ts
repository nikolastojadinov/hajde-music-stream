import { parseTracksFromInnertube, type ParsedTrack } from "./playlistParser";

type Runs = Array<{ text?: string; navigationEndpoint?: { browseEndpoint?: { browseId?: string } } }> | undefined;

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

const collectSubtitleRuns = (data: any): Runs => {
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

const extractYear = (data: any, subtitleRuns: Runs): string | null => {
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
  const title = extractTitle(browseJson);
  const subtitleRuns = collectSubtitleRuns(browseJson);
  const artist = extractArtist(browseJson);
  const year = extractYear(browseJson, subtitleRuns);
  const thumbnail = extractThumbnail(browseJson);
  const tracks = parseTracksFromInnertube(browseJson, artist, thumbnail);

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
