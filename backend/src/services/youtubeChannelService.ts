import env from "../environments";

export type ChannelDetails = {
  id: string;
  title: string;
  thumbnailUrl?: string | null;
  bannerUrl?: string | null;
  country?: string | null;
  subscribers?: number | null;
  views?: number | null;
};

export type ChannelPlaylist = {
  id: string;
  title: string;
  description?: string | null;
  channelId: string;
  channelTitle?: string | null;
  thumbnailUrl?: string | null;
  itemCount?: number | null;
  etag?: string | null;
};

const YOUTUBE_API_BASE = "https://www.googleapis.com/youtube/v3";
const PAGE_SIZE = 50;

function maskApiKey(value?: string | null): string {
  if (!value || value.length === 0) return "unknown";
  return `${value.slice(0, 6)}...`;
}

function maskUrlApiKey(url: URL): string {
  const sanitized = new URL(url.toString());
  const key = sanitized.searchParams.get("key");
  if (key) sanitized.searchParams.set("key", maskApiKey(key));
  return sanitized.toString();
}

export async function fetchChannelDetails(channelId: string, apiKey: string = env.youtube_api_key): Promise<ChannelDetails> {
  if (!apiKey) throw new Error("YOUTUBE_API_KEY not configured");
  const url = new URL(`${YOUTUBE_API_BASE}/channels`);
  url.searchParams.set("part", "snippet,statistics,brandingSettings");
  url.searchParams.set(
    "fields",
    "items(id,snippet(title,thumbnails/default/url,country),statistics(subscriberCount,viewCount),brandingSettings/image/bannerExternalUrl)"
  );
  url.searchParams.set("id", channelId);
  url.searchParams.set("maxResults", "1");
  url.searchParams.set("key", apiKey);

  const response = await fetch(url.toString());
  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(`channels.list failed ${response.status}: ${body.slice(0, 200)}`);
  }
  const json: any = await response.json();
  const item = Array.isArray(json?.items) ? json.items[0] : null;
  if (!item || typeof item.id !== "string") {
    throw new Error("channels.list returned empty result");
  }

  const title = item?.snippet?.title ?? "Unknown Artist";
  const thumbnailUrl = item?.snippet?.thumbnails?.default?.url ?? null;
  const bannerUrl = item?.brandingSettings?.image?.bannerExternalUrl ?? null;
  const country = item?.snippet?.country ?? null;
  const subscribers = item?.statistics?.subscriberCount ? Number(item.statistics.subscriberCount) : null;
  const views = item?.statistics?.viewCount ? Number(item.statistics.viewCount) : null;

  return {
    id: item.id,
    title,
    thumbnailUrl,
    bannerUrl,
    country,
    subscribers: Number.isFinite(subscribers) ? subscribers : null,
    views: Number.isFinite(views) ? views : null,
  };
}

export async function fetchChannelPlaylists(channelId: string, apiKey: string = env.youtube_api_key): Promise<ChannelPlaylist[]> {
  if (!apiKey) throw new Error("YOUTUBE_API_KEY not configured");

  const playlists: ChannelPlaylist[] = [];
  let pageToken: string | undefined;
  let page = 1;

  while (true) {
    const url = new URL(`${YOUTUBE_API_BASE}/playlists`);
    url.searchParams.set("part", "snippet,contentDetails");
    url.searchParams.set(
      "fields",
      "items(id,etag,snippet(title,description,channelTitle,channelId,thumbnails/default/url),contentDetails/itemCount),nextPageToken"
    );
    url.searchParams.set("maxResults", PAGE_SIZE.toString());
    url.searchParams.set("channelId", channelId);
    url.searchParams.set("key", apiKey);
    if (pageToken) url.searchParams.set("pageToken", pageToken);

    const response = await fetch(url.toString());
    if (!response.ok) {
      const body = await response.text().catch(() => "");
      throw new Error(`playlists.list failed ${response.status}: ${body.slice(0, 200)}`);
    }

    const json: any = await response.json();
    const items = Array.isArray(json?.items) ? json.items : [];

    for (const raw of items) {
      if (!raw || typeof raw.id !== "string") continue;
      const snippet = raw.snippet ?? {};
      playlists.push({
        id: raw.id,
        title: snippet.title ?? "Untitled playlist",
        description: snippet.description ?? null,
        channelId: snippet.channelId ?? channelId,
        channelTitle: snippet.channelTitle ?? null,
        thumbnailUrl: snippet?.thumbnails?.default?.url ?? null,
        itemCount: raw?.contentDetails?.itemCount ?? null,
        etag: typeof raw?.etag === "string" ? raw.etag : null,
      });
    }

    pageToken = typeof json?.nextPageToken === "string" ? json.nextPageToken : undefined;
    if (!pageToken) break;
    page += 1;
    // Safety guard against runaway pagination
    if (page > 50) break;
  }

  return playlists;
}
