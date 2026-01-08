type Runs = Array<{ text?: string; navigationEndpoint?: { browseEndpoint?: { browseId?: string } } }> | undefined;

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
  subtitle: string | null;
  thumbnail: string | null;
  tracks: ParsedTrack[];
};

function normalizeString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function textOrNull(value: unknown): string | null {
  const text = normalizeString(value);
  return text === "" ? null : text;
}

function pickLastThumbnail(thumbnails?: any): string | null {
  const arr = Array.isArray(thumbnails) ? thumbnails : thumbnails?.thumbnails;
  if (!Array.isArray(arr) || arr.length === 0) return null;
  const last = arr[arr.length - 1];
  return textOrNull(last?.url);
}

function startsWithUc(browseId: string | null | undefined): boolean {
  return typeof browseId === "string" && browseId.startsWith("UC");
}

function extractHeaderTitle(data: any): string | null {
  const microTitle = textOrNull(data?.microformat?.microformatDataRenderer?.title);
  if (microTitle) return microTitle;
  return textOrNull(data?.header?.musicDetailHeaderRenderer?.title?.runs?.[0]?.text);
}

function extractHeaderAlbumArtist(data: any): string | null {
  const runs: Runs = data?.header?.musicDetailHeaderRenderer?.subtitle?.runs;
  if (!Array.isArray(runs)) return null;
  for (const run of runs) {
    const browseId = normalizeString(run?.navigationEndpoint?.browseEndpoint?.browseId);
    if (!startsWithUc(browseId)) continue;
    const name = textOrNull(run?.text);
    if (name) return name;
  }
  return null;
}

function extractHeaderThumbnail(data: any): string | null {
  const headerThumb = pickLastThumbnail(
    data?.header?.musicDetailHeaderRenderer?.thumbnail?.croppedSquareThumbnailRenderer?.thumbnail?.thumbnails
  );
  if (headerThumb) return headerThumb;
  return pickLastThumbnail(data?.microformat?.microformatDataRenderer?.thumbnail?.thumbnails);
}

function extractTrackArtist(renderer: any, albumArtist: string | null): string | null {
  const runs: Runs = renderer?.flexColumns?.[1]?.musicResponsiveListItemFlexColumnRenderer?.text?.runs;
  if (Array.isArray(runs)) {
    for (const run of runs) {
      const browseId = normalizeString(run?.navigationEndpoint?.browseEndpoint?.browseId);
      if (!startsWithUc(browseId)) continue;
      const name = textOrNull(run?.text);
      if (name) return name;
    }
  }
  return albumArtist;
}

function extractTrackThumbnail(renderer: any, albumThumbnail: string | null): string | null {
  const thumb = pickLastThumbnail(renderer?.thumbnail?.musicThumbnailRenderer?.thumbnail?.thumbnails);
  if (thumb) return thumb;
  return albumThumbnail;
}

export function parsePlaylistFromInnertube(browseJson: any, browseId: string): ParsedPlaylist {
  const data = browseJson;

  const title = extractHeaderTitle(data);
  const albumArtist = extractHeaderAlbumArtist(data);
  const albumThumbnail = extractHeaderThumbnail(data);

  const trackItems =
    data?.contents?.twoColumnBrowseResultsRenderer?.secondaryContents?.sectionListRenderer?.contents?.[0]?.musicShelfRenderer?.contents ?? [];

  const tracks: ParsedTrack[] = Array.isArray(trackItems)
    ? trackItems
        .map((item: any) => item?.musicResponsiveListItemRenderer)
        .filter(Boolean)
        .map((renderer: any) => {
          const videoId = textOrNull(renderer?.playNavigationEndpoint?.watchEndpoint?.videoId);

          const trackTitle = textOrNull(
            renderer?.flexColumns?.[0]?.musicResponsiveListItemFlexColumnRenderer?.text?.runs?.[0]?.text
          );

          const duration = textOrNull(
            renderer?.fixedColumns?.[0]?.musicResponsiveListItemFixedColumnRenderer?.text?.runs?.[0]?.text
          );

          const artist = extractTrackArtist(renderer, albumArtist);
          const thumbnail = extractTrackThumbnail(renderer, albumThumbnail);

          return {
            videoId,
            title: trackTitle,
            artist,
            duration,
            thumbnail,
          };
        })
    : [];

  return {
    id: browseId,
    title,
    subtitle: null,
    thumbnail: albumThumbnail,
    tracks,
  };
}type Runs = Array<{ text?: string; navigationEndpoint?: { browseEndpoint?: { browseId?: string } } }> | undefined;

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
  subtitle: string | null;
  thumbnail: string | null;
  tracks: ParsedTrack[];
};

function normalizeString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function textOrNull(value: unknown): string | null {
  const text = normalizeString(value);
  return text === "" ? null : text;
}

function pickLastThumbnail(thumbnails?: any): string | null {
  const arr = Array.isArray(thumbnails) ? thumbnails : thumbnails?.thumbnails;
  if (!Array.isArray(arr) || arr.length === 0) return null;
  const last = arr[arr.length - 1];
  return textOrNull(last?.url);
}

function startsWithUc(browseId: string | null | undefined): boolean {
  if (!browseId) return false;
  return browseId.startsWith("UC");
}

function extractHeaderTitle(data: any): string | null {
  const microTitle = textOrNull(data?.microformat?.microformatDataRenderer?.title);
  if (microTitle) return microTitle;
  return textOrNull(data?.header?.musicDetailHeaderRenderer?.title?.runs?.[0]?.text);
}

function extractHeaderAlbumArtist(data: any): string | null {
  const runs: Runs = data?.header?.musicDetailHeaderRenderer?.subtitle?.runs;
  if (!Array.isArray(runs)) return null;
  for (const run of runs) {
    const browseId = normalizeString(run?.navigationEndpoint?.browseEndpoint?.browseId);
    if (startsWithUc(browseId)) {
      const name = textOrNull(run?.text);
      if (name) return name;
    }
  }
  return null;
}

function extractHeaderThumbnail(data: any): string | null {
  const headerThumb = pickLastThumbnail(
    data?.header?.musicDetailHeaderRenderer?.thumbnail?.croppedSquareThumbnailRenderer?.thumbnail?.thumbnails
  );
  if (headerThumb) return headerThumb;
  return pickLastThumbnail(data?.microformat?.microformatDataRenderer?.thumbnail?.thumbnails);
}

function extractTrackArtist(renderer: any, albumArtist: string | null): string | null {
  const runs: Runs = renderer?.flexColumns?.[1]?.musicResponsiveListItemFlexColumnRenderer?.text?.runs;
  if (Array.isArray(runs)) {
    for (const run of runs) {
      const browseId = normalizeString(run?.navigationEndpoint?.browseEndpoint?.browseId);
      if (startsWithUc(browseId)) {
        const name = textOrNull(run?.text);
        if (name) return name;
      }
    }
  }
  return albumArtist;
}

function extractTrackThumbnail(renderer: any, albumThumbnail: string | null): string | null {
  const thumb = pickLastThumbnail(renderer?.thumbnail?.musicThumbnailRenderer?.thumbnail?.thumbnails);
  if (thumb) return thumb;
  return albumThumbnail;
}

export function parsePlaylistFromInnertube(browseJson: any, browseId: string): ParsedPlaylist {
  const data = browseJson;

  const title = extractHeaderTitle(data);
  const albumArtist = extractHeaderAlbumArtist(data);
  const albumThumbnail = extractHeaderThumbnail(data);

  const trackItems =
    data?.contents?.twoColumnBrowseResultsRenderer?.secondaryContents?.sectionListRenderer?.contents?.[0]?.musicShelfRenderer?.contents ?? [];

  const tracks: ParsedTrack[] = Array.isArray(trackItems)
    ? trackItems
        .map((item: any) => item?.musicResponsiveListItemRenderer)
        .filter(Boolean)
        .map((renderer: any) => {
          const videoId = textOrNull(
            renderer?.playNavigationEndpoint?.watchEndpoint?.videoId
          );

          const trackTitle = textOrNull(
            renderer?.flexColumns?.[0]?.musicResponsiveListItemFlexColumnRenderer?.text?.runs?.[0]?.text
          );

          const duration = textOrNull(
            renderer?.fixedColumns?.[0]?.musicResponsiveListItemFixedColumnRenderer?.text?.runs?.[0]?.text
          );

          const artist = extractTrackArtist(renderer, albumArtist);

          const thumbnail = extractTrackThumbnail(renderer, albumThumbnail);

          return {
            videoId,
            title: trackTitle,
            artist,
            duration,
            thumbnail,
          };
        })
    : [];

  return {
    id: browseId,
    title,
    subtitle: null,
    thumbnail: albumThumbnail,
    tracks,
  };
}type Runs = Array<{ text?: string; navigationEndpoint?: { browseEndpoint?: { browseId?: string } } }> | undefined;

export type PlaylistTrack = {
  videoId: string | null;
  title: string | null;
  artist: string | null;
  duration: string | null;
  thumbnail: string | null;
};

export type ParsedPlaylist = {
  id: string;
  title: string | null;
  subtitle: string | null;
  thumbnail: string | null;
  tracks: PlaylistTrack[];
};

function normalizeString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function pickLastThumbnail(thumbnails?: any): string | null {
  const arr = Array.isArray(thumbnails) ? thumbnails : thumbnails?.thumbnails;
  if (!Array.isArray(arr) || arr.length === 0) return null;
  const last = arr[arr.length - 1];
  const url = normalizeString(last?.url);
  return url || null;
}

export function parsePlaylistFromInnertube(browseJson: any, browseId: string): ParsedPlaylist {
  const data = browseJson;

  const title =
    data?.microformat?.microformatDataRenderer?.title ??
    data?.header?.musicDetailHeaderRenderer?.title?.runs?.[0]?.text ??
    null;

  const playlistThumbnail =
    pickLastThumbnail(
      data?.header?.musicDetailHeaderRenderer?.thumbnail?.croppedSquareThumbnailRenderer?.thumbnail?.thumbnails
    ) ??
    pickLastThumbnail(data?.microformat?.microformatDataRenderer?.thumbnail?.thumbnails) ??
    null;

  const trackItems =
    data?.contents?.twoColumnBrowseResultsRenderer?.secondaryContents?.sectionListRenderer?.contents?.[0]?.musicShelfRenderer?.contents ??
    [];

  const tracks: PlaylistTrack[] = Array.isArray(trackItems)
    ? trackItems
        .map((item: any) => item?.musicResponsiveListItemRenderer)
        .filter(Boolean)
        .map((renderer: any) => {
          const trackTitle = renderer?.flexColumns?.[0]?.musicResponsiveListItemFlexColumnRenderer?.text?.runs?.[0]?.text ?? null;

          const duration =
            renderer?.fixedColumns?.[0]?.musicResponsiveListItemFixedColumnRenderer?.text?.runs?.[0]?.text ?? null;

          const videoId = renderer?.playlistItemData?.videoId ?? null;

          const artist =
            renderer?.menu?.menuRenderer?.items
              ?.map((i: any) => i?.menuNavigationItemRenderer)
              ?.find((i: any) => i?.text?.runs?.[0]?.text === "Go to artist")
              ?.navigationEndpoint?.browseEndpoint?.browseId ?? null;

          const thumbnail = pickLastThumbnail(
            renderer?.thumbnail?.musicThumbnailRenderer?.thumbnail?.thumbnails
          );

          return {
            videoId,
            title: trackTitle,
            artist,
            duration,
            thumbnail,
          };
        })
    : [];

  return {
    id: browseId,
    title,
    subtitle: null,
    thumbnail: playlistThumbnail,
    tracks,
  };
}
