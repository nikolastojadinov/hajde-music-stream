import supabase from "./supabaseClient";
import env from "../environments";
import { deriveArtistKey } from "./artistResolver";

const LOG_PREFIX = "[ingest]";
const YT_BASE = "https://www.googleapis.com/youtube/v3";
const MAX_VIDEOS = 5;
const MAX_PLAYLISTS = 1;

type IngestParams = {
  youtube_channel_id: string;
  artistName?: string;
};

type ChannelDetails = {
  id: string;
  title: string;
  thumbnailUrl: string | null;
};

type VideoRow = {
  external_id: string;
  youtube_id: string;
  title: string;
  artist: string | null;
  cover_url: string | null;
  artist_channel_id: string | null;
  duration: null;
  source: "youtube";
};

type PlaylistRow = {
  external_id: string;
  title: string;
  description: string | null;
  cover_url: string | null;
  channel_id: string | null;
  channel_title: string | null;
  item_count: number | null;
  sync_status: string;
};

function normalizeString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function pickThumb(snippet: any): string | null {
  const thumb = snippet?.thumbnails?.default?.url;
  return typeof thumb === "string" && thumb.length > 0 ? thumb : null;
}

function requireApiKey(): string {
  const key = env.youtube_api_key;
  if (!key) {
    throw new Error("missing YOUTUBE_API_KEY");
  }
  return key;
}

async function fetchJson(url: URL): Promise<any> {
  const response = await fetch(url.toString());
  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(`${url.pathname} failed ${response.status}: ${body.slice(0, 200)}`);
  }
  const json = await response.json().catch(() => null);
  if (!json || typeof json !== "object") {
    throw new Error(`${url.pathname} invalid json`);
  }
  return json;
}

async function fetchChannel(channelId: string): Promise<ChannelDetails | null> {
  const key = requireApiKey();
  const url = new URL(`${YT_BASE}/channels`);
  url.searchParams.set("part", "snippet,contentDetails");
  url.searchParams.set("fields", "items(id,snippet(title,thumbnails/default/url),contentDetails/relatedPlaylists/uploads)");
  url.searchParams.set("id", channelId);
  url.searchParams.set("maxResults", "1");
  url.searchParams.set("key", key);

  const json = await fetchJson(url);
  const item = Array.isArray((json as any)?.items) ? (json as any).items[0] : null;
  if (!item || typeof item.id !== "string") return null;

  const title = normalizeString(item?.snippet?.title) || channelId;
  const thumbnailUrl = pickThumb(item?.snippet);
  return { id: item.id, title, thumbnailUrl };
}

async function fetchLatestVideos(channelId: string, artist: string): Promise<VideoRow[]> {
  const key = requireApiKey();
  const url = new URL(`${YT_BASE}/search`);
  url.searchParams.set("part", "snippet");
  url.searchParams.set("type", "video");
  url.searchParams.set("order", "date");
  url.searchParams.set("maxResults", String(MAX_VIDEOS));
  url.searchParams.set("channelId", channelId);
  url.searchParams.set("fields", "items(id/videoId,snippet(title,channelId,channelTitle,thumbnails/default/url))");
  url.searchParams.set("key", key);

  const json = await fetchJson(url);
  const items = Array.isArray((json as any)?.items) ? (json as any).items : [];
  const seen = new Set<string>();

  const rows: VideoRow[] = [];
  for (const item of items) {
    const videoId = normalizeString(item?.id?.videoId);
    const title = normalizeString(item?.snippet?.title);
    const channelIdFromItem = normalizeString(item?.snippet?.channelId) || channelId;
    if (!videoId || !title || seen.has(videoId)) continue;
    seen.add(videoId);

    rows.push({
      external_id: videoId,
      youtube_id: videoId,
      title,
      artist: artist || null,
      cover_url: pickThumb(item?.snippet),
      artist_channel_id: channelIdFromItem || null,
      duration: null,
      source: "youtube",
    });
  }

  return rows;
}

async function fetchOnePlaylist(channelId: string): Promise<PlaylistRow | null> {
  const key = requireApiKey();
  const url = new URL(`${YT_BASE}/playlists`);
  url.searchParams.set("part", "snippet,contentDetails");
  url.searchParams.set("maxResults", String(MAX_PLAYLISTS));
  url.searchParams.set("channelId", channelId);
  url.searchParams.set("fields", "items(id,snippet(title,description,channelId,channelTitle,thumbnails/default/url),contentDetails/itemCount)");
  url.searchParams.set("key", key);

  const json = await fetchJson(url);
  const items = Array.isArray((json as any)?.items) ? (json as any).items : [];
  const first = items[0];
  const playlistId = normalizeString(first?.id);
  if (!playlistId) return null;

  const snippet = first?.snippet ?? {};
  const title = normalizeString(snippet?.title) || "Untitled playlist";
  return {
    external_id: playlistId,
    title,
    description: normalizeString(snippet?.description) || null,
    cover_url: pickThumb(snippet),
    channel_id: normalizeString(snippet?.channelId) || null,
    channel_title: normalizeString(snippet?.channelTitle) || null,
    item_count: typeof first?.contentDetails?.itemCount === "number" ? first.contentDetails.itemCount : null,
    sync_status: "fetched",
  };
}

export async function ingestArtistFromYouTubeByChannelId(params: IngestParams): Promise<{
  artist_id: string | null;
  tracks_inserted: number;
  playlist_inserted: boolean;
} | null> {
  const youtube_channel_id = normalizeString(params.youtube_channel_id);
  const providedArtistName = normalizeString(params.artistName);

  if (!youtube_channel_id || !supabase) return null;

  try {
    const channel = await fetchChannel(youtube_channel_id);
    if (!channel) return null;

    const artistName = providedArtistName || channel.title || youtube_channel_id;
    const artist_key = deriveArtistKey(artistName);
    if (!artist_key) return null;

    let artist_id: string | null = null;

    const existing = await supabase
      .from("artists")
      .select("id")
      .eq("youtube_channel_id", youtube_channel_id)
      .maybeSingle();

    if (existing?.data?.id) {
      artist_id = String(existing.data.id);
      console.info(`${LOG_PREFIX} already_exists`, { youtube_channel_id, artist_id });
    }

    const artistRow = {
      artist: artistName,
      artist_key,
      youtube_channel_id,
      thumbnail_url: channel.thumbnailUrl,
      banner_url: null,
      subscribers: null,
      views: null,
      country: null,
      source: "youtube",
    };

    const upsertArtist = await supabase
      .from("artists")
      .upsert(artistRow, { onConflict: "youtube_channel_id" })
      .select("id")
      .maybeSingle();

    if (upsertArtist?.data?.id) {
      artist_id = String(upsertArtist.data.id);
      if (!existing?.data?.id) {
        console.info(`${LOG_PREFIX} artist_created`, { youtube_channel_id, artist_id });
      }
    }

    const videos = await fetchLatestVideos(youtube_channel_id, artistName);
    let tracks_inserted = 0;
    if (videos.length > 0) {
      const { data, error } = await supabase
        .from("tracks")
        .upsert(videos as any, { onConflict: "external_id" })
        .select("id");

      if (error) {
        console.warn(`${LOG_PREFIX} tracks_upsert_failed`, { youtube_channel_id, message: error.message });
      } else {
        tracks_inserted = Array.isArray(data) ? data.length : 0;
        console.info(`${LOG_PREFIX} tracks_inserted`, { youtube_channel_id, count: tracks_inserted });
      }
    }

    let playlist_inserted = false;
    const playlist = await fetchOnePlaylist(youtube_channel_id);
    if (playlist) {
      const { data, error } = await supabase
        .from("playlists")
        .upsert(playlist as any, { onConflict: "external_id" })
        .select("id");

      if (error) {
        console.warn(`${LOG_PREFIX} playlist_upsert_failed`, { youtube_channel_id, message: error.message });
      } else {
        playlist_inserted = Array.isArray(data) ? data.length > 0 : false;
      }
    }

    return { artist_id, tracks_inserted, playlist_inserted };
  } catch (err: any) {
    console.warn(`${LOG_PREFIX} error`, { youtube_channel_id, message: err?.message ? String(err.message) : "unknown" });
    return null;
  }
}
