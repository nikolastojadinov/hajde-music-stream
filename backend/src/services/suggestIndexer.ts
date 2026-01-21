import { getSupabaseAdmin } from "./supabaseClient";

const PER_RUN_TARGET = 1;
const CANDIDATE_SCAN_LIMIT = 50;
const SOURCE_TAG = "artist_indexer";

type ArtistRow = {
  artist_key: string;
  artist: string | null;
  display_name: string | null;
  normalized_name: string | null;
  created_at: string | null;
  youtube_channel_id: string | null;
};

function normalizeQuery(value: string | null | undefined): string {
  if (!value) return "";
  return value.toString().trim().toLowerCase().normalize("NFKD").replace(/\p{Diacritic}+/gu, "");
}

function buildPrefixes(normalized: string): string[] {
  const output: string[] = [];
  const minLen = 2;
  const maxLen = Math.min(normalized.length, 120);
  for (let i = minLen; i <= maxLen; i++) {
    output.push(normalized.slice(0, i));
  }
  return output;
}

function pickNormalizedQuery(row: ArtistRow): string {
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

async function insertSuggestEntries(channelId: string, normalizedQuery: string): Promise<number> {
  const client = getSupabaseAdmin();
  const prefixes = buildPrefixes(normalizedQuery);
  if (!prefixes.length) return 0;

  const seenAt = new Date().toISOString();
  const rows = prefixes.map((prefix) => ({
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
    meta: { artist_channel_id: channelId },
    hit_count: 1,
    last_seen_at: seenAt,
  }));

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

    const normalizedQuery = pickNormalizedQuery(row);
    if (!normalizedQuery) continue;

    const insertedCount = await insertSuggestEntries(channelId, normalizedQuery);
    if (insertedCount <= 0) continue;

    const marked = await markArtistProcessed(channelId);
    if (!marked) continue;

    processed += 1;
    console.log("[suggest-indexer] artist_done", { channelId, normalizedQuery });
  }

  console.log("[suggest-indexer] tick_complete", { processed });
  return { processed };
}

export const DAILY_ARTIST_SUGGEST_CRON = "*/5 * * * *";

export async function runArtistSuggestTick(): Promise<void> {
  await runSuggestIndexerTick();
}
