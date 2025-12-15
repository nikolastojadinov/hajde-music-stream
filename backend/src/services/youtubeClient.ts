import { logApiUsage } from './apiUsageLogger';

export type YouTubeVideoSearchResult = {
  videoId: string;
  title: string;
  channelId: string;
  channelTitle: string;
  thumbUrl?: string;
};

export type YouTubeChannelSearchResult = {
  channelId: string;
  title: string;
  thumbUrl?: string;
};

const YOUTUBE_SEARCH_ENDPOINT = 'https://www.googleapis.com/youtube/v3/search';
const MAX_RESULTS = 5;
const MIN_QUERY_CHARS = 2;
const QUOTA_COST_SEARCH_LIST = 100;

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

async function executeSearch(params: Record<string, string>, apiKeyForHash: string): Promise<any> {
  const url = new URL(YOUTUBE_SEARCH_ENDPOINT);
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value);
  }

  let status: 'ok' | 'error' = 'ok';
  let errorCode: string | null = null;
  let errorMessage: string | null = null;

  try {
    const response = await fetch(url.toString(), { method: 'GET' });

    if (!response.ok) {
      status = 'error';
      errorCode = String(response.status);
      errorMessage = 'YouTube search failed';
      throw new Error('YouTube search failed');
    }

    const json = await response.json().catch(() => null);
    if (!json || typeof json !== 'object') {
      status = 'error';
      errorMessage = 'YouTube search failed';
      throw new Error('YouTube search failed');
    }

    return json;
  } catch (err) {
    if (err instanceof Error && err.message === 'YouTube search failed') {
      throw err;
    }
    status = 'error';
    errorMessage = errorMessage ?? 'YouTube search failed';
    throw new Error('YouTube search failed');
  } finally {
    void logApiUsage({
      apiKeyOrIdentifier: apiKeyForHash,
      endpoint: 'youtube.search.list',
      quotaCost: QUOTA_COST_SEARCH_LIST,
      status,
      errorCode,
      errorMessage,
    });
  }
}

export async function youtubeSearchVideos(q: string): Promise<YouTubeVideoSearchResult[]> {
  const query = normalizeQuery(q);
  if (query.length < MIN_QUERY_CHARS) {
    return [];
  }

  const apiKey = getApiKey();

  const json = await executeSearch(
    {
      key: apiKey,
      part: 'snippet',
      type: 'video',
      videoCategoryId: '10',
      maxResults: String(MAX_RESULTS),
      fields: 'items(id/videoId,snippet/title,snippet/channelId,snippet/channelTitle,snippet/thumbnails/default/url)',
      q: query,
    },
    apiKey
  );

  const items = Array.isArray((json as any).items) ? (json as any).items : [];

  return items
    .filter((item: any) => item?.id?.videoId && item?.snippet?.title && item?.snippet?.channelId)
    .map((item: any) => {
      const out: YouTubeVideoSearchResult = {
        videoId: String(item.id.videoId),
        title: String(item.snippet.title),
        channelId: String(item.snippet.channelId),
        channelTitle: item?.snippet?.channelTitle ? String(item.snippet.channelTitle) : '',
      };
      const thumbUrl = pickDefaultThumbUrl(item?.snippet?.thumbnails);
      if (thumbUrl) out.thumbUrl = thumbUrl;
      return out;
    });
}

export async function youtubeSearchArtistChannel(q: string): Promise<YouTubeChannelSearchResult[]> {
  const query = normalizeQuery(q);
  if (query.length < MIN_QUERY_CHARS) {
    return [];
  }

  const apiKey = getApiKey();

  const json = await executeSearch(
    {
      key: apiKey,
      part: 'snippet',
      type: 'channel',
      maxResults: '2',
      fields: 'items(id/channelId,snippet/title,snippet/thumbnails/default/url)',
      q: query,
    },
    apiKey
  );

  const items = Array.isArray((json as any).items) ? (json as any).items : [];

  return items
    .filter((item: any) => item?.id?.channelId && item?.snippet?.title)
    .map((item: any) => {
      const out: YouTubeChannelSearchResult = {
        channelId: String(item.id.channelId),
        title: String(item.snippet.title),
      };
      const thumbUrl = pickDefaultThumbUrl(item?.snippet?.thumbnails);
      if (thumbUrl) out.thumbUrl = thumbUrl;
      return out;
    });
}
