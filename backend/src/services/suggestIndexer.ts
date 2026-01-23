// target file: backend/src/services/suggestIndexer.ts
// FULL REWRITE — replace entire file content with this version.
// FIX: stable next-unprocessed artist selection (no RPC, no offset, no repeats)

import { getSupabaseAdmin } from "./supabaseClient";

type ArtistRow = {
  artist_key: string;
  artist: string | null;
  display_name: string | null;
  normalized_name: string | null;
  created_at: string | null;
  updated_at: string | null;
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
  return value
    .toString()
    .trim()
    .toLowerCase()
    .normalize("NFKD")
    .replace(/\p{Diacritic}+/gu, "");
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

function buildRows(
  prefixes: string[],
  channelId: string,
  normalizedName: string,
  seenAt: string
): SuggestEntryRow[] {
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

/**
 * ✅ REAL FIX:
 * Fetch next artist NOT present in suggest_queries
 * (no subquery parser bug, no RPC, no offset)
 */
async function fetchNextArtist(): Promise<ArtistRow | null> {
  const client = getSupabaseAdmin();

  // 1) Pull candidate artists
  const { data: artists, error } = await client
    .from("artists")
    .select(
      "artist_key, artist, display_name, normalized_name, created_at, updated_at, youtube_channel_id"
    )
    .not("youtube_channel_id", "is", null)
    .neq("youtube_channel_id", "")
    .order("updated_at", { ascending: true })
    .limit(50);

  if (error) {
    console.error("[suggest-indexer] artist_fetch_failed", error.message);
    return null;
  }

  if (!artists || artists.length === 0) return null;

  // 2) Check which ones are already processed
  const channelIds = artists
    .map((a) => (a.youtube_channel_id || "").trim())
    .filter(Boolean);

  const { data: processed, error: pErr } = await client
    .from("suggest_queries")
    .select("artist_channel_id")
    .in("artist_channel_id", channelIds);

  if (pErr) {
    console.error("[suggest-indexer] processed_fetch_failed", pErr.message);
    return null;
  }

  const processedSet = new Set(
    (processed || []).map((r) => (r.artist_channel_id || "").trim())
  );

  // 3) Return first unprocessed artist
  for (const a of artists) {
    const cid = (a.youtube_channel_id || "").trim();
    if (!processedSet.has(cid)) return a;
  }

  return null;
}

async function insertSuggestEntries(
  rows: SuggestEntryRow[]
): Promise<{ success: boolean; inserted: number }> {
  if (!rows.length) return { success: false, inserted: 0 };

  const client = getSupabaseAdmin();
  const { data, error } = await client
    .from("suggest_entries")
    .upsert(rows, {
      onConflict: "source,normalized_query,artist_channel_id,entity_type",
    })
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

  const { error } = await client.from("suggest_queries").upsert(payload, {
    onConflict: "artist_channel_id",
  });

  if (error) {
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
  const normalizedName = pickNormalizedName(artist);

  const prefixes = buildPrefixes(normalizedName);
  const seenAt = new Date().toISOString();
  const rows = buildRows(prefixes, channelId, normalizedName, seenAt);

  const insertResult = await insertSuggestEntries(rows);
  if (!insertResult.success) return { processed: 0 };

  await markArtistProcessed(channelId);

  processed = 1;
  console.log("[suggest-indexer] artist_done", {
    channelId,
    normalizedName,
    insertedCount: insertResult.inserted,
  });

  return { processed };
}

export const DAILY_ARTIST_SUGGEST_CRON = "*/5 7-20 * * *";

export async function runArtistSuggestTick(): Promise<void> {
  await runSuggestIndexerTick();
}
