import { getSupabaseAdmin } from "./supabaseClient";

const PER_RUN_TARGET = 1;
const CANDIDATE_SCAN_LIMIT = 50;

type ArtistRow = {
  artist_key: string;
  artist: string | null;
  display_name: string | null;
  normalized_name: string | null;
  created_at: string | null;
  youtube_channel_id: string | null;
};

type ArtistRowWithJoin = ArtistRow & {
  suggest_queries?: Array<{ artist_channel_id: string | null } | null> | null;
};

function normalizeQuery(value: string | null | undefined): string {
  if (!value) return "";
  return value.toString().trim().toLowerCase().normalize("NFKD").replace(/\p{Diacritic}+/gu, "");
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
    .select(
      "artist_key, artist, display_name, normalized_name, created_at, youtube_channel_id, suggest_queries!left(artist_channel_id)"
    )
    .not("youtube_channel_id", "is", null)
    .is("suggest_queries.artist_channel_id", null)
    .order("created_at", { ascending: true })
    .order("artist_key", { ascending: true })
    .limit(limit);

  if (error) {
    console.error("[suggest-indexer] artist_fetch_failed", error.message);
    return [];
  }

  const rows = (data ?? []) as ArtistRowWithJoin[];

  return rows.map((row: ArtistRowWithJoin) => ({
    artist_key: row.artist_key,
    artist: row.artist,
    display_name: row.display_name,
    normalized_name: row.normalized_name,
    created_at: row.created_at,
    youtube_channel_id: row.youtube_channel_id,
  }));
}

async function markArtistProcessed(channelId: string, normalizedName: string): Promise<void> {
  const client = getSupabaseAdmin();
  const payload = {
    artist_channel_id: channelId,
    normalized_query: normalizedName || channelId,
    created_at: new Date().toISOString(),
  };

  const { error } = await client.from("suggest_queries").upsert(payload, { onConflict: "artist_channel_id" });
  if (error) throw new Error(`[suggest-indexer] mark_processed_failed: ${error.message}`);
}

function pickArtistName(row: ArtistRow): string {
  return (
    normalizeQuery(row.display_name) ||
    normalizeQuery(row.artist) ||
    normalizeQuery(row.normalized_name) ||
    normalizeQuery(row.artist_key)
  );
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

    const normalizedName = pickArtistName(row);
    if (!normalizedName) continue;

    // Suggest generation assumed to succeed elsewhere.
    await markArtistProcessed(channelId, normalizedName);
    processed += 1;
    console.log("[suggest-indexer] artist_done", { channelId, normalizedName });
  }

  return { processed };
}

// Backwards compatibility for existing scheduler wiring.
export const DAILY_ARTIST_SUGGEST_CRON = "*/5 * * * *";
export async function runArtistSuggestTick(): Promise<void> {
  const result = await runSuggestIndexerTick();
  console.log("[suggest-indexer] tick_complete", result);
}
