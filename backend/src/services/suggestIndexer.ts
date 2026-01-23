import { getSupabaseAdmin } from "./supabaseClient";

type ArtistRow = {
  artist_key: string;
  artist: string | null;
  display_name: string | null;
  normalized_name: string | null;
  created_at: string | null;
  youtube_channel_id: string | null;
};

type SuggestEntryRow = {
  query: string;
  normalized_query: string;
  source: string;
  results: Record<string, unknown>;
  meta: Record<string, unknown>;
  hit_count: number;
  last_seen_at: string;
  artist_channel_id: string;
  entity_type: "artist" | "album" | "playlist" | "track";
};

const SOURCE_TAG = "artist_indexer";
const MIN_PREFIX_LENGTH = 2;
const MAX_PREFIX_LENGTH = 120;
const ENTITY_TYPES = ["artist", "album", "playlist", "track"] as const;

function normalizeQuery(value: string | null | undefined): string {
  if (!value) return "";
  return value.toString().trim().toLowerCase().normalize("NFKD").replace(/\p{Diacritic}+/gu, "");
}

function buildPrefixes(normalized: string): string[] {
  const prefixes: string[] = [];
  const maxLen = Math.min(normalized.length, MAX_PREFIX_LENGTH);
  for (let i = MIN_PREFIX_LENGTH; i <= maxLen; i++) {
    prefixes.push(normalized.slice(0, i));
  }
  return prefixes;
}

function pickNormalizedName(row: ArtistRow): string {
  return (
    normalizeQuery(row.display_name) ||
    normalizeQuery(row.artist) ||
    normalizeQuery(row.normalized_name) ||
    normalizeQuery(row.artist_key)
  );
}

function buildRows(prefixes: string[], channelId: string, normalizedName: string, seenAt: string): SuggestEntryRow[] {
  const rows: SuggestEntryRow[] = [];
  for (const prefix of prefixes) {
    for (const entity_type of ENTITY_TYPES) {
      rows.push({
        query: prefix,
        normalized_query: prefix,
        source: SOURCE_TAG,
        results: {
          type: entity_type,
          title: normalizedName,
          artist_channel_id: channelId,
          endpointType: "browse",
          endpointPayload: channelId,
        },
        meta: { artist_channel_id: channelId, entity_type },
        hit_count: 1,
        last_seen_at: seenAt,
        artist_channel_id: channelId,
        entity_type,
      });
    }
  }
  return rows;
}

async function isProcessed(channelId: string): Promise<boolean> {
  const client = getSupabaseAdmin();
  const { data, error } = await client
    .from("suggest_queries")
    .select("artist_channel_id")
    .eq("artist_channel_id", channelId)
    .limit(1)
    .maybeSingle();

  if (error && error.code !== "PGRST116") {
    console.error("[suggest-indexer] processed_check_failed", error.message);
    return false;
  }

  return Boolean(data);
}

const LOOKBACK_HOURS = 24;
const FETCH_LIMIT = 200; // allow progressing through recent artists without getting stuck
const LOOKBACK_FIELD = "updated_at"; // nightly ingest touches updated_at, created_at can be old

async function fetchNextArtist(): Promise<ArtistRow | null> {
  const client = getSupabaseAdmin();
  const since = new Date(Date.now() - LOOKBACK_HOURS * 60 * 60 * 1000).toISOString();

  // First, try only artists touched in the recent window (by updated_at).
  const { data, error } = await client
    .from("artists")
    .select("artist_key, artist, display_name, normalized_name, created_at, youtube_channel_id, updated_at")
    .not("youtube_channel_id", "is", null)
    .gte(LOOKBACK_FIELD, since)
    .order(LOOKBACK_FIELD, { ascending: true })
    .limit(FETCH_LIMIT);

  if (error) {
    console.error("[suggest-indexer] artist_fetch_failed", error.message);
    return null;
  }

  const candidates = data && data.length ? data : null;

  // If nothing in the recent window, fall back to oldest with a channel (avoid starvation).
  const rows = candidates
    ? candidates
    : (await client
        .from("artists")
        .select("artist_key, artist, display_name, normalized_name, created_at, youtube_channel_id, updated_at")
        .not("youtube_channel_id", "is", null)
        .order(LOOKBACK_FIELD, { ascending: true })
        .limit(FETCH_LIMIT)).data;

  if (!rows || !rows.length) return null;

  for (const artist of rows) {
    const channelId = (artist.youtube_channel_id || "").trim();
    if (!channelId) continue;
    const processed = await isProcessed(channelId);
    if (!processed) return artist;
  }

  return null;
}

async function insertSuggestEntries(rows: SuggestEntryRow[]): Promise<{ success: boolean; inserted: number }> {
  if (!rows.length) return { success: false, inserted: 0 };

  const client = getSupabaseAdmin();
  const { data, error } = await client
    .from("suggest_entries")
    .upsert(rows, { onConflict: "source,normalized_query,artist_channel_id,entity_type" })
    .select("id");

  if (error) {
    console.error("[suggest-indexer] entries_upsert_failed", error.message);
    return { success: false, inserted: 0 };
  }

  return { success: true, inserted: data?.length ?? 0 };
}

async function markArtistProcessed(channelId: string): Promise<boolean> {
  const client = getSupabaseAdmin();
  const payload = {
    artist_channel_id: channelId,
    created_at: new Date().toISOString(),
  };

  const { error } = await client
    .from("suggest_queries")
    .insert(payload, { onConflict: "artist_channel_id" })
    .select("artist_channel_id")
    .single();

  if (error && error.code !== "23505") {
    console.error("[suggest-indexer] mark_processed_failed", error.message);
    return false;
  }

  return true;
}

export async function runSuggestIndexerTick(): Promise<{ processed: number }> {
  let processed = 0;

  const artist = await fetchNextArtist();
  if (!artist) {
    console.log("[suggest-indexer] tick_complete", { processed });
    return { processed };
  }

  const channelId = (artist.youtube_channel_id || "").trim();
  if (!channelId) {
    console.log("[suggest-indexer] tick_complete", { processed });
    return { processed };
  }

  const normalizedName = pickNormalizedName(artist);
  if (!normalizedName || normalizedName.length < MIN_PREFIX_LENGTH) {
    console.log("[suggest-indexer] tick_complete", { processed });
    return { processed };
  }

  const prefixes = buildPrefixes(normalizedName);
  if (!prefixes.length) {
    console.log("[suggest-indexer] tick_complete", { processed });
    return { processed };
  }

  const seenAt = new Date().toISOString();
  const rows = buildRows(prefixes, channelId, normalizedName, seenAt);

  const insertResult = await insertSuggestEntries(rows);
  if (!insertResult.success || insertResult.inserted <= 0) {
    console.log("[suggest-indexer] tick_complete", { processed });
    return { processed };
  }

  const marked = await markArtistProcessed(channelId);
  if (!marked) {
    console.log("[suggest-indexer] tick_complete", { processed });
    return { processed };
  }

  processed = 1;
  const totalPrefixes = prefixes.length;
  const insertedCount = insertResult.inserted;
  console.log("[suggest-indexer] artist_done", { channelId, normalizedName, totalPrefixes, insertedCount });
  console.log("[suggest-indexer] tick_complete", { processed });
  return { processed };
}

// Run every 5 minutes between 07:00 and 21:00 (hour range 7-20 inclusive)
export const DAILY_ARTIST_SUGGEST_CRON = "*/5 7-20 * * *";

export async function runArtistSuggestTick(): Promise<void> {
  await runSuggestIndexerTick();
}

