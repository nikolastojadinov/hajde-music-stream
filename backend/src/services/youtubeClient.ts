import { logApiUsage } from './apiUsageLogger';

// Custom error for YouTube quota exceeded
export class YouTubeQuotaExceededError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'YouTubeQuotaExceededError';
  }
}

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

export type YouTubePlaylistSearchResult = {
  playlistId: string;
  title: string;
  channelId: string;
  channelTitle: string;
  thumbUrl?: string;
};

export type YouTubeMixedSearchResult = {
  channels: YouTubeChannelSearchResult[];
  videos: YouTubeVideoSearchResult[];
  playlists: YouTubePlaylistSearchResult[];
};

const YOUTUBE_SEARCH_ENDPOINT = 'https://www.googleapis.com/youtube/v3/search';
const MAX_RESULTS = 5;
const MIN_QUERY_CHARS = 2;
const QUOTA_COST_SEARCH_LIST = 100;
const MUSIC_VIDEO_CATEGORY_ID = '10';

// IMPORTANT: The YouTube Data API uses a Google partial response selector syntax.
// Use parentheses, not slash-delimited paths, to avoid 400 badRequest invalidArgument.
const FIELDS_VIDEO = 'items(id(videoId),snippet(title,channelId,channelTitle,thumbnails(default(url))))';
const FIELDS_CHANNEL = 'items(id(channelId),snippet(title,thumbnails(default(url))))';
const FIELDS_MIXED = 'items(id(kind,videoId,channelId,playlistId),snippet(title,channelId,channelTitle,thumbnails(default(url))))';

function normalizeQuery(q: string): string {
  return typeof q === 'string' ? q.trim() : '';
}

function getApiKey(): string {
  const apiKey = process.env.YOUTUBE_API_KEY;
  if (!apiKey) {
    throw new Error('YouTube search failed: missing YOUTUBE_API_KEY');
  }
  return apiKey;
}

function pickDefaultThumbUrl(thumbnails: any): string | undefined {
  const url = thumbnails?.default?.url;
  return typeof url === 'string' && url.length > 0 ? url : undefined;
}

function isLikelyMusicContentTitle(value: unknown): boolean {
  const raw = typeof value === 'string' ? value.trim() : '';
  if (!raw) return false;
  const t = raw.toLowerCase();

  // Conservative blacklist to avoid pulling clearly non-music content.
  // (This is not perfect, but it prevents obvious mismatches like podcasts, gameplay, trailers, etc.)
  const banned = [
    'podcast',
    'episode',
    'interview',
    'trailer',
    'movie',
    'film',
    'gameplay',
    'walkthrough',
    'reaction',
    'review',
    'vlog',
    'stream',
    'highlights',
    'compilation',
    'lecture',
    'lesson',
    'tutorial',
    'how to',
    'news',
  ];
  for (const b of banned) {
    if (t.includes(b)) return false;
  }

  return true;
}

function normalizeKind(kind: unknown): string {
  return typeof kind === 'string' ? kind : '';
}

function tryExtractYouTubeErrorDetails(body: unknown): { reason?: string; message?: string } {
  if (!body || typeof body !== 'object') return {};
  const err = (body as any).error;
  if (!err || typeof err !== 'object') return {};

  const message = typeof err.message === 'string' ? err.message : undefined;
  const first = Array.isArray(err.errors) ? err.errors[0] : null;
  const reason = first && typeof first.reason === 'string' ? first.reason : undefined;
  return { reason, message };
}

async function safeReadJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return null;
  }
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
      const body = await safeReadJson(response);
      const details = tryExtractYouTubeErrorDetails(body);
      const reason = details.reason ? ` (${details.reason})` : '';
      const msg = details.message ? `: ${details.message}` : '';
      errorMessage = `YouTube search failed${reason}${msg}`;
      
      // Check if this is a quota exceeded error
      if (details.reason === 'quotaExceeded' || errorCode === '403') {
        console.error('[YouTubeClient] QUOTA_EXCEEDED', { reason: details.reason, message: details.message, statusCode: errorCode });
        throw new YouTubeQuotaExceededError(errorMessage);
      }
      
      throw new Error(errorMessage);
    }

    const json = await safeReadJson(response);
    if (!json || typeof json !== 'object') {
      status = 'error';
      errorMessage = 'YouTube search failed: invalid JSON response';
      throw new Error(errorMessage);
    }

    return json;
  } catch (err) {
    status = 'error';
    if (err instanceof YouTubeQuotaExceededError) {
      // Re-throw quota exceeded errors as-is
      errorMessage = err.message;
      throw err;
    }
    if (err instanceof Error) {
      // Preserve the most specific message we have.
      errorMessage = errorMessage ?? err.message;
      throw err;
    }
    errorMessage = errorMessage ?? 'YouTube search failed';
    throw new Error(String(errorMessage));
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
      // Music category only.
      videoCategoryId: MUSIC_VIDEO_CATEGORY_ID,
      maxResults: String(MAX_RESULTS),
      fields: FIELDS_VIDEO,
      q: query,
    },
    apiKey
  );

  const items = Array.isArray((json as any).items) ? (json as any).items : [];

  return items
    .filter((item: any) => item?.id?.videoId && item?.snippet?.title && item?.snippet?.channelId)
    .filter((item: any) => isLikelyMusicContentTitle(item?.snippet?.title))
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
      fields: FIELDS_CHANNEL,
      q: query,
    },
    apiKey
  );

  const items = Array.isArray((json as any).items) ? (json as any).items : [];

  return items
    .filter((item: any) => item?.id?.channelId && item?.snippet?.title)
    .filter((item: any) => isLikelyMusicContentTitle(item?.snippet?.title))
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

/**
 * One YouTube Data API `search.list` call that returns a mix of:
 * - channels
 * - videos (music category)
 * - playlists
 */
export async function youtubeSearchMixed(q: string): Promise<YouTubeMixedSearchResult> {
  const query = normalizeQuery(q);
  if (query.length < MIN_QUERY_CHARS) {
    return { channels: [], videos: [], playlists: [] };
  }

  const apiKey = getApiKey();

  // NOTE: YouTube Data API does NOT support comma-separated `type` values.
  // A single request with `type=video,channel,playlist` fails with 400 invalidArgument.
  // We intentionally do 3 small calls and merge.
  const [channelsJson, videosJson, playlistsJson] = await Promise.all([
    executeSearch(
      {
        key: apiKey,
        part: 'snippet',
        type: 'channel',
        maxResults: '5',
        fields: FIELDS_MIXED,
        q: query,
      },
      apiKey
    ),
    executeSearch(
      {
        key: apiKey,
        part: 'snippet',
        type: 'video',
        // Music-only constraint for videos.
        videoCategoryId: MUSIC_VIDEO_CATEGORY_ID,
        maxResults: '15',
        fields: FIELDS_MIXED,
        q: query,
      },
      apiKey
    ),
    executeSearch(
      {
        key: apiKey,
        part: 'snippet',
        type: 'playlist',
        maxResults: '10',
        fields: FIELDS_MIXED,
        q: query,
      },
      apiKey
    ),
  ]);

  const items = [
    ...(Array.isArray((channelsJson as any).items) ? (channelsJson as any).items : []),
    ...(Array.isArray((videosJson as any).items) ? (videosJson as any).items : []),
    ...(Array.isArray((playlistsJson as any).items) ? (playlistsJson as any).items : []),
  ];
  const channels: YouTubeChannelSearchResult[] = [];
  const videos: YouTubeVideoSearchResult[] = [];
  const playlists: YouTubePlaylistSearchResult[] = [];

  for (const item of items) {
    const kind = normalizeKind(item?.id?.kind);
    const title = item?.snippet?.title ? String(item.snippet.title) : '';
    const channelId = item?.snippet?.channelId ? String(item.snippet.channelId) : '';
    const channelTitle = item?.snippet?.channelTitle ? String(item.snippet.channelTitle) : '';
    const thumbUrl = pickDefaultThumbUrl(item?.snippet?.thumbnails);

    const videoId = item?.id?.videoId ? String(item.id.videoId) : '';
    const chId = item?.id?.channelId ? String(item.id.channelId) : '';
    const playlistId = item?.id?.playlistId ? String(item.id.playlistId) : '';

    if (kind.includes('youtube#channel') && chId && title) {
      if (!isLikelyMusicContentTitle(title)) continue;
      const out: YouTubeChannelSearchResult = { channelId: chId, title };
      if (thumbUrl) out.thumbUrl = thumbUrl;
      channels.push(out);
      continue;
    }

    if (kind.includes('youtube#video') && videoId && title && channelId) {
      if (!isLikelyMusicContentTitle(title)) continue;
      const out: YouTubeVideoSearchResult = {
        videoId,
        title,
        channelId,
        channelTitle,
      };
      if (thumbUrl) out.thumbUrl = thumbUrl;
      videos.push(out);
      continue;
    }

    if (kind.includes('youtube#playlist') && playlistId && title) {
      if (!isLikelyMusicContentTitle(title)) continue;
      const out: YouTubePlaylistSearchResult = {
        playlistId,
        title,
        channelId,
        channelTitle,
      };
      if (thumbUrl) out.thumbUrl = thumbUrl;
      playlists.push(out);
      continue;
    }
  }

  return { channels, videos, playlists };
}
