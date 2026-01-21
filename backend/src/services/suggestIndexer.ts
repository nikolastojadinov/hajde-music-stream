import { getSupabaseAdmin } from "./supabaseClient";

const PER_RUN_TARGET = 1;
const CANDIDATE_SCAN_LIMIT = 50;
const SOURCE_TAG = "artist_indexer";

const MIN_PREFIX_LENGTH = 2;
const MAX_PREFIX_LENGTH = 120;

type ArtistRow = {
  artist_key: string;
  artist: string | null;
  display_name: string | null;
  normalized_name: string | null;
  created_at: string | null;
  youtube_channel_id: string | null;
};

type AlbumRow = {
  id: string;
  external_id: string | null;
  title: string | null;
  cover_url: string | null;
  thumbnail_url: string | null;
};

type TrackRow = {
  id: string;
  youtube_id: string | null;
  title: string | null;
};

type PlaylistRow = {
  id: string;
  external_id: string | null;
  title: string | null;
  cover_url: string | null;
  image_url: string | null;
};

type SuggestRow = {
  query: string;
  normalized_query: string;
  source: string;
  results: Record<string, unknown>;
  meta: Record<string, unknown>;
  hit_count: number;
  last_seen_at: string;
};

function normalizeQuery(value: string | null | undefined): string {
  if (!value) return "";
  return value.toString().trim().toLowerCase().normalize("NFKD").replace(/\p{Diacritic}+/gu, "");
}

function buildPrefixes(normalized: string): string[] {
  const out: string[] = [];
  const maxLen = Math.min(normalized.length, MAX_PREFIX_LENGTH);
  for (let i = MIN_PREFIX_LENGTH; i <= maxLen; i++) {
    out.push(normalized.slice(0, i));
  }
  return out;
}

function pickNormalizedArtistQuery(row: ArtistRow): string {
  return (
    normalizeQuery(row.display_name) ||
    normalizeQuery(row.artist) ||
    normalizeQuery(row.normalized_name) ||
    normalizeQuery(row.artist_key)
  );
}

async function artistAlreadyProcessed(channelId: string): Promise<boolean> {
  const client = getSupabaseAdmin();
  const { data, error } = await client
    .from("suggest_queries")
    .select("artist_channel_id")
    .eq("artist_channel_id", channelId)
    .limit(1)
    .maybeSingle();

  if (error && error.code !== "PGRST116") {
    console.error("[suggest-indexer] processed_check_failed", error.message);
    return true;
  }

  return Boolean(data);
}

async function fetchArtistBatch(limit: number): Promise<ArtistRow[]> {
  const client = getSupabaseAdmin();
  const { data, error } = await client
    .from("artists")
    .select("artist_key, artist, display_name, normalized_name, created_at, youtube_channel_id")
    .not("youtube_channel_id", "is", null)
    .order("created_at", { ascending: true })
    .order("artist_key", { ascending: true })
    .limit(limit);

  if (error) {
    console.error("[suggest-indexer] artist_fetch_failed", error.message);
    return [];
  }

  return data ?? [];
}

async function fetchAlbums(channelId: string, artistKey: string): Promise<AlbumRow[]> {
  const client = getSupabaseAdmin();
  const { data, error } = await client
    .from("albums")
    .select("id, external_id, title, cover_url, thumbnail_url")
    .or(`artist_channel_id.eq.${channelId},artist_key.eq.${artistKey}`)
    .limit(50);

  if (error) {
    console.error("[suggest-indexer] albums_fetch_failed", error.message);
    return [];
  }

  return data ?? [];
}

async function fetchTracks(channelId: string, artistKey: string): Promise<TrackRow[]> {
  const client = getSupabaseAdmin();
  const { data, error } = await client
    .from("tracks")
    .select("id, youtube_id, title")
    .or(`artist_channel_id.eq.${channelId},artist_key.eq.${artistKey}`)
    .limit(50);

  if (error) {
    console.error("[suggest-indexer] tracks_fetch_failed", error.message);
    return [];
  }

  return data ?? [];
}

async function fetchPlaylists(channelId: string): Promise<PlaylistRow[]> {
  const client = getSupabaseAdmin();
  const { data, error } = await client
    .from("playlists")
    .select("id, external_id, title, cover_url, image_url, channel_id")
    .eq("channel_id", channelId)
    .limit(50);

  if (error) {
    console.error("[suggest-indexer] playlists_fetch_failed", error.message);
    return [];
  }

  return (data ?? []).map(({ id, external_id, title, cover_url, image_url }) => ({
    id,
    external_id,
    title,
    cover_url,
    image_url,
  }));
}

function buildArtistSuggestRows(prefixes: string[], channelId: string, normalizedQuery: string, seenAt: string): SuggestRow[] {
  return prefixes.map((prefix) => ({
    query: prefix,
    normalized_query: prefix,
    source: SOURCE_TAG,
    results: {
      type: "artist",
      title: normalizedQuery,
      artist_channel_id: channelId,
      endpointType: "browse",
      endpointPayload: channelId,
    },
    meta: { artist_channel_id: channelId, entity_type: "artist" },
    hit_count: 1,
    last_seen_at: seenAt,
  }));
}

function buildAlbumSuggestRows(prefixes: string[], albums: AlbumRow[], channelId: string, seenAt: string): SuggestRow[] {
  const rows: SuggestRow[] = [];
  for (const album of albums) {
    const albumId = album.external_id || album.id;
    if (!albumId) continue;
    const title = album.title || albumId;
    for (const prefix of prefixes) {
      rows.push({
        query: prefix,
        normalized_query: prefix,
        source: SOURCE_TAG,
        results: {
          type: "album",
          title,
          album_id: albumId,
          imageUrl: album.cover_url || album.thumbnail_url || null,
          endpointType: "browse",
          endpointPayload: albumId,
        },
        meta: { artist_channel_id: channelId, entity_type: "album", album_id: albumId },
        hit_count: 1,
        last_seen_at: seenAt,
      });
    }
  }
  return rows;
}

function buildTrackSuggestRows(prefixes: string[], tracks: TrackRow[], channelId: string, seenAt: string): SuggestRow[] {
  const rows: SuggestRow[] = [];
  for (const track of tracks) {
    const videoId = track.youtube_id || track.id;
    if (!videoId) continue;
    const title = track.title || videoId;
    for (const prefix of prefixes) {
      rows.push({
        query: prefix,
        normalized_query: prefix,
        source: SOURCE_TAG,
        results: {
          type: "song",
          title,
          video_id: videoId,
          endpointType: "watch",
          endpointPayload: videoId,
        },
        meta: { artist_channel_id: channelId, entity_type: "song", video_id: videoId },
        hit_count: 1,
        last_seen_at: seenAt,
      });
    }
  }
  return rows;
}

function buildPlaylistSuggestRows(prefixes: string[], playlists: PlaylistRow[], channelId: string, seenAt: string): SuggestRow[] {
  const rows: SuggestRow[] = [];
  for (const playlist of playlists) {
    const pid = playlist.external_id || playlist.id;
    if (!pid) continue;
    const title = playlist.title || pid;
    const imageUrl = playlist.cover_url || playlist.image_url || null;
    for (const prefix of prefixes) {
      rows.push({
        query: prefix,
        normalized_query: prefix,
        source: SOURCE_TAG,
        results: {
          type: "playlist",
          title,
          playlist_id: pid,
          imageUrl,
          endpointType: "browse",
          endpointPayload: pid,
        },
        meta: { artist_channel_id: channelId, entity_type: "playlist", playlist_id: pid },
        hit_count: 1,
        last_seen_at: seenAt,
      });
    }
  }
  return rows;
}

async function insertSuggestEntries(rows: SuggestRow[]): Promise<number> {
  if (!rows.length) return 0;
  const client = getSupabaseAdmin();
  const { data, error } = await client.from("suggest_entries").insert(rows).select("id");
  if (error) {
    console.error("[suggest-indexer] entries_insert_failed", error.message);
    return 0;
  }
  return data?.length ?? 0;
}

async function markArtistProcessed(channelId: string): Promise<boolean> {
  const client = getSupabaseAdmin();
  const payload = {
    artist_channel_id: channelId,
    created_at: new Date().toISOString(),
  };

  const { error } = await client.from("suggest_queries").upsert(payload, { onConflict: "artist_channel_id" });
  if (error) {
    console.error("[suggest-indexer] mark_processed_failed", error.message);
    return false;
  }

  return true;
}

export async function runSuggestIndexerTick(): Promise<{ processed: number }> {
  let processed = 0;
  const candidates = await fetchArtistBatch(CANDIDATE_SCAN_LIMIT);

  for (const row of candidates) {
    if (processed >= PER_RUN_TARGET) break;

    const channelId = (row.youtube_channel_id || "").trim();
    if (!channelId) continue;

    const alreadyProcessed = await artistAlreadyProcessed(channelId);
    if (alreadyProcessed) continue;

    const normalizedQuery = pickNormalizedArtistQuery(row);
    if (!normalizedQuery) continue;

    const prefixes = buildPrefixes(normalizedQuery);
    if (!prefixes.length) continue;

    const seenAt = new Date().toISOString();

    const [albums, tracks, playlists] = await Promise.all([
      fetchAlbums(channelId, row.artist_key),
      fetchTracks(channelId, row.artist_key),
      fetchPlaylists(channelId),
    ]);

    const rowsToInsert: SuggestRow[] = [];
    rowsToInsert.push(...buildArtistSuggestRows(prefixes, channelId, normalizedQuery, seenAt));
    rowsToInsert.push(...buildAlbumSuggestRows(prefixes, albums, channelId, seenAt));
    rowsToInsert.push(...buildTrackSuggestRows(prefixes, tracks, channelId, seenAt));
    rowsToInsert.push(...buildPlaylistSuggestRows(prefixes, playlists, channelId, seenAt));

    const insertedCount = await insertSuggestEntries(rowsToInsert);
    if (insertedCount <= 0) continue;

    const marked = await markArtistProcessed(channelId);
    if (!marked) continue;

    processed += 1;
    console.log("[suggest-indexer] artist_done", { channelId, normalizedQuery, insertedCount });
  }

  console.log("[suggest-indexer] tick_complete", { processed });
  return { processed };
}

export const DAILY_ARTIST_SUGGEST_CRON = "*/5 * * * *";

export async function runArtistSuggestTick(): Promise<void> {
  await runSuggestIndexerTick();
}
