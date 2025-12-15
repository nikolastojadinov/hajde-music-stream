export type YouTubeVideoSearchResult = {
  videoId: string;
  title: string;
  channelTitle: string;
  thumbUrl?: string;
};

export type YouTubePlaylistSearchResult = {
  playlistId: string;
  title: string;
  channelTitle: string;
  thumbUrl?: string;
};

const YOUTUBE_SEARCH_ENDPOINT = 'https://www.googleapis.com/youtube/v3/search';
const MAX_RESULTS = 5;
const MIN_QUERY_CHARS = 2;

function normalizeQuery(q: string): string {
  return typeof q === 'string' ? q.trim() : '';
}

function getApiKey(): string {
  const apiKey = process.env.YOUTUBE_API_KEY;
  if (!apiKey) {
    throw new Error('YouTube search failed');
  }
  return apiKey;
}

function pickDefaultThumbUrl(thumbnails: any): string | undefined {
  const url = thumbnails?.default?.url;
  return typeof url === 'string' && url.length > 0 ? url : undefined;
}

async function executeSearch(params: Record<string, string>): Promise<any> {
  const url = new URL(YOUTUBE_SEARCH_ENDPOINT);
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value);
  }

  const response = await fetch(url.toString(), { method: 'GET' });
  if (!response.ok) {
    throw new Error('YouTube search failed');
  }

  const json = await response.json().catch(() => null);
  if (!json || typeof json !== 'object') {
    throw new Error('YouTube search failed');
  }

  return json;
}

export async function youtubeSearchVideos(q: string): Promise<YouTubeVideoSearchResult[]> {
  const query = normalizeQuery(q);
  if (query.length < MIN_QUERY_CHARS) {
    return [];
  }

  const apiKey = getApiKey();

  const json = await executeSearch({
    key: apiKey,
    part: 'snippet',
    type: 'video',
    videoCategoryId: '10',
    maxResults: String(MAX_RESULTS),
    fields:
      'items(id/videoId,snippet/title,snippet/channelTitle,snippet/thumbnails/default/url)',
    q: query,
  });

  const items = Array.isArray((json as any).items) ? (json as any).items : [];

  return items
    .filter((item: any) => item?.id?.videoId && item?.snippet?.title)
    .map((item: any) => {
      const out: YouTubeVideoSearchResult = {
        videoId: String(item.id.videoId),
        title: String(item.snippet.title),
        channelTitle: item?.snippet?.channelTitle ? String(item.snippet.channelTitle) : '',
      };
      const thumbUrl = pickDefaultThumbUrl(item?.snippet?.thumbnails);
      if (thumbUrl) out.thumbUrl = thumbUrl;
      return out;
    });
}

export async function youtubeSearchPlaylists(q: string): Promise<YouTubePlaylistSearchResult[]> {
  const query = normalizeQuery(q);
  if (query.length < MIN_QUERY_CHARS) {
    return [];
  }

  const apiKey = getApiKey();

  const json = await executeSearch({
    key: apiKey,
    part: 'snippet',
    type: 'playlist',
    maxResults: String(MAX_RESULTS),
    fields:
      'items(id/playlistId,snippet/title,snippet/channelTitle,snippet/thumbnails/default/url)',
    q: query,
  });

  const items = Array.isArray((json as any).items) ? (json as any).items : [];

  return items
    .filter((item: any) => item?.id?.playlistId && item?.snippet?.title)
    .map((item: any) => {
      const out: YouTubePlaylistSearchResult = {
        playlistId: String(item.id.playlistId),
        title: String(item.snippet.title),
        channelTitle: item?.snippet?.channelTitle ? String(item.snippet.channelTitle) : '',
      };
      const thumbUrl = pickDefaultThumbUrl(item?.snippet?.thumbnails);
      if (thumbUrl) out.thumbUrl = thumbUrl;
      return out;
    });
}
