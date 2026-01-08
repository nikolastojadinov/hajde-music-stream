type Runs = Array<{ text?: string; navigationEndpoint?: { browseEndpoint?: { browseId?: string } } }> | undefined;

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
