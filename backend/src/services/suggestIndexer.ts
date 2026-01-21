import { getSupabaseAdmin } from "./supabaseClient";

const CANDIDATE_SCAN_LIMIT = 1;
const SOURCE_TAG = "artist_indexer";
const MIN_PREFIX_LENGTH = 2;
const MAX_PREFIX_LENGTH = 120;

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
};

type UpsertResult = {
  success: boolean;
  inserted: number;
};

async function fetchNextArtist(): Promise<ArtistRow | null> {
  const client = getSupabaseAdmin();
  const { data, error } = await client
    .from("artists")
    .select("artist_key, artist, display_name, normalized_name, created_at, youtube_channel_id")
    .not("youtube_channel_id", "is", null)
    .order("created_at", { ascending: true })
    .limit(CANDIDATE_SCAN_LIMIT);

  if (error) {
    console.error("[suggest-indexer] artist_fetch_failed", error.message);
    return null;
  }

  return (data && data.length > 0) ? data[0] : null;
}

async function alreadyCompleted(channelId: string): Promise<boolean> {
  const client = getSupabaseAdmin();
  const { data, error } = await client
    .from("suggest_queries")
    .select("artist_channel_id")
    .eq("artist_channel_id", channelId)
    .limit(1)
    .maybeSingle();

  if (error && error.code !== "PGRST116") {
    console.error("[suggest-indexer] completion_check_failed", error.message);
    return true;
  }

  return Boolean(data);
}

function pickNormalizedName(row: ArtistRow): string {
  return (
    normalizeQuery(row.display_name) ||
    normalizeQuery(row.artist) ||
    normalizeQuery(row.normalized_name) ||
    normalizeQuery(row.artist_key)
  );
}

function buildArtistRows(prefixes: string[], channelId: string, normalizedName: string, seenAt: string): SuggestEntryRow[] {
  return prefixes.map((prefix) => ({
    query: prefix,
    normalized_query: prefix,
    source: SOURCE_TAG,
    results: {
      type: "artist",
      title: normalizedName,
      artist_channel_id: channelId,
      endpointType: "browse",
      endpointPayload: channelId,
    },
    meta: { artist_channel_id: channelId, entity_type: "artist" },
    hit_count: 1,
    last_seen_at: seenAt,
    artist_channel_id: channelId,
  }));
}

async function upsertSuggestEntries(rows: SuggestEntryRow[]): Promise<UpsertResult> {
  if (!rows.length) return { success: false, inserted: 0 };
  const client = getSupabaseAdmin();
  const { data, error } = await client
    .from("suggest_entries")
    .upsert(rows, { onConflict: "artist_channel_id,normalized_query", ignoreDuplicates: true })
    .select("id");

  if (error) {
    console.error("[suggest-indexer] entries_upsert_failed", error.message);
    return { success: false, inserted: 0 };
  }

  return { success: true, inserted: data?.length ?? 0 };
}

async function countEntriesForArtist(channelId: string): Promise<number> {
  const client = getSupabaseAdmin();
  const { count, error } = await client
    .from("suggest_entries")
    .select("id", { count: "exact", head: true })
    .eq("artist_channel_id", channelId);

  if (error) {
    console.error("[suggest-indexer] entries_count_failed", error.message);
    return 0;
  }

  return count ?? 0;
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

  const done = await alreadyCompleted(channelId);
  if (done) {
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
  const rows = buildArtistRows(prefixes, channelId, normalizedName, seenAt);

  const upsertResult = await upsertSuggestEntries(rows);
  if (!upsertResult.success) {
    console.log("[suggest-indexer] tick_complete", { processed });
    return { processed };
  }

  const count = await countEntriesForArtist(channelId);
  if (count <= 0) {
    console.log("[suggest-indexer] tick_complete", { processed });
    return { processed };
  }

  const marked = await markArtistProcessed(channelId);
  if (!marked) {
    console.log("[suggest-indexer] tick_complete", { processed });
    return { processed };
  }

  processed = 1;
  console.log("[suggest-indexer] artist_done", { channelId, normalizedName, prefixesInserted: prefixes.length });
  console.log("[suggest-indexer] tick_complete", { processed });
  return { processed };
}

export const DAILY_ARTIST_SUGGEST_CRON = "*/5 * * * *";

export async function runArtistSuggestTick(): Promise<void> {
  await runSuggestIndexerTick();
}
