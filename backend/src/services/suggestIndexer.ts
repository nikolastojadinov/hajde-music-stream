import type { SearchResultItem, SearchResultsPayload } from "../lib/youtubeMusicClient";
import { musicSearch } from "../lib/youtubeMusicClient";
import supabase, { getSupabaseAdmin } from "./supabaseClient";

type CanonicalArtist = {
  id: string;
  name: string;
  channelId: string;
  imageUrl: string | null;
  subtitle: string;
  endpointPayload: string;
  endpointType: SearchResultItem["endpointType"];
  pageType?: string;
};

type ExistingRow = {
  id: number;
  hit_count?: number;
};

const MIN_PREFIX_LENGTH = 2;
const SOURCE_TAG = "search_result_artist";
const MAX_PREFIX_COUNT = 120;
const DAILY_BATCH_SIZE = 100;
const DAILY_BATCH_CRON = "0 7 * * *"; // 07:00 server time
const DEFAULT_DELAY_BETWEEN_ARTISTS_MS = 1500;

function normalizeQuery(value: string): string {
  const lowered = (value || "").toString().toLowerCase().normalize("NFKD");
  const stripped = lowered.replace(/\p{Diacritic}+/gu, "");
  return stripped.trim().replace(/\s+/g, " ");
}

function buildPrefixes(normalized: string): string[] {
  const output: string[] = [];
  const length = Math.min(normalized.length, MAX_PREFIX_COUNT);
  for (let i = MIN_PREFIX_LENGTH; i <= length; i++) {
    output.push(normalized.slice(0, i));
  }
  return output;
}

function toCanonicalArtist(item: SearchResultItem | null | undefined): CanonicalArtist | null {
  if (!item || item.kind !== "artist" || item.isOfficial !== true) return null;
  const channelId = item.endpointPayload || item.id;
  if (!channelId) return null;

  return {
    id: item.id,
    name: item.title,
    channelId,
    imageUrl: item.imageUrl ?? null,
    subtitle: item.subtitle ?? "",
    endpointPayload: item.endpointPayload,
    endpointType: item.endpointType,
    pageType: item.pageType,
  };
}

function pickTopOfficialArtist(payload: SearchResultsPayload): CanonicalArtist | null {
  const priorityLists: Array<Array<SearchResultItem | null | undefined>> = [
    [payload.featured],
    Array.isArray(payload.sections?.artists) ? payload.sections.artists : [],
    Array.isArray(payload.orderedItems) ? payload.orderedItems : [],
  ];

  const seen = new Set<string>();
  for (const list of priorityLists) {
    for (const entry of list) {
      const canonical = toCanonicalArtist(entry);
      if (!canonical) continue;

      const key = `${canonical.channelId}`;
      if (seen.has(key)) continue;
      seen.add(key);
      return canonical;
    }
  }

  return null;
}

function buildResultPayload(artist: CanonicalArtist) {
  return {
    id: artist.id,
    channelId: artist.channelId,
    name: artist.name,
    subtitle: artist.subtitle,
    imageUrl: artist.imageUrl,
    endpointType: artist.endpointType,
    endpointPayload: artist.endpointPayload,
    pageType: artist.pageType,
    isOfficial: true,
  };
}

function buildMeta(artist: CanonicalArtist) {
  return {
    entity_type: "artist",
    artist_channel_id: artist.channelId,
    artist_page_type: artist.pageType ?? null,
  } as const;
}

async function findExisting(prefix: string, channelId: string): Promise<ExistingRow | null> {
  const { data, error } = await supabase
    .from("suggest_entries")
    .select("id, hit_count")
    .eq("normalized_query", prefix)
    .eq("meta->>artist_channel_id", channelId)
    .limit(1)
    .maybeSingle();

  if (error) {
    console.error("[suggest-indexer] lookup failed", error.message);
    return null;
  }

  return data ?? null;
}

async function upsertPrefix(prefix: string, artist: CanonicalArtist, seenAt: string, source: string): Promise<void> {
  const existing = await findExisting(prefix, artist.channelId);
  if (existing && typeof existing.id !== "number") return;

  const payload = {
    query: prefix,
    normalized_query: prefix,
    source: source || SOURCE_TAG,
    results: buildResultPayload(artist),
    meta: buildMeta(artist),
    hit_count: existing ? (typeof existing.hit_count === "number" ? existing.hit_count + 1 : 1) : 1,
    last_seen_at: seenAt,
  };

  if (existing) {
    const { error } = await supabase.from("suggest_entries").update(payload).eq("id", existing.id);
    if (error) console.error("[suggest-indexer] update failed", error.message);
    return;
  }

  const { error } = await supabase.from("suggest_entries").insert(payload);
  if (error) console.error("[suggest-indexer] insert failed", error.message);
}

export async function indexSuggestFromSearch(queryRaw: string, payload: SearchResultsPayload): Promise<void> {
  if (!supabase) return;

  const normalized = normalizeQuery(queryRaw);
  if (!normalized || normalized.length < MIN_PREFIX_LENGTH) return;

  const canonicalArtist = pickTopOfficialArtist(payload);
  if (!canonicalArtist) return;

  const prefixes = buildPrefixes(normalized);
  if (!prefixes.length) return;

  const seenAt = new Date().toISOString();
  const source = payload?.source || SOURCE_TAG;

  for (const prefix of prefixes) {
    try {
      await upsertPrefix(prefix, canonicalArtist, seenAt, source);
    } catch (err) {
      console.error("[suggest-indexer] upsert failed", err instanceof Error ? err.message : String(err));
    }
  }
}

// NOTE: suggest_queries is intentionally unused and kept only as historical log in the DB if present.
// It must never block or short-circuit ingestion paths in this file.

type ArtistRow = {
  artist_key: string;
  artist: string | null;
  display_name: string | null;
  normalized_name: string | null;
  created_at: string | null;
};

export type SuggestBatchConfig = {
  batchSize?: number;
  delayBetweenArtistsMs?: number;
};

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function pickArtistName(row: ArtistRow): string {
  return (
    normalizeQuery(row.display_name || "") ||
    normalizeQuery(row.artist || "") ||
    normalizeQuery(row.normalized_name || "") ||
    normalizeQuery(row.artist_key || "")
  );
}

function dayIndex(): number {
  return Math.floor(Date.now() / 86_400_000);
}

async function fetchArtistBatch(batchSize: number): Promise<ArtistRow[]> {
  const client = getSupabaseAdmin();
  const day = dayIndex();

  const { data: countRows, error: countError, count } = await client
    .from("artists")
    .select("artist_key", { count: "exact", head: true });

  if (countError) throw new Error(`[suggest-indexer] artist count failed: ${countError.message}`);
  const total = typeof count === "number" && count > 0 ? count : 0;
  if (!total) return [];

  const start = (day * batchSize) % total;
  const end = start + batchSize - 1;

  const selectColumns = "artist_key, artist, display_name, normalized_name, created_at";

  const fetchRange = async (from: number, to: number) => {
    const { data, error } = await client
      .from("artists")
      .select(selectColumns)
      .order("created_at", { ascending: true })
      .range(from, to);
    if (error) throw new Error(`[suggest-indexer] artist fetch failed: ${error.message}`);
    return Array.isArray(data) ? (data as ArtistRow[]) : [];
  };

  // Single contiguous range fits
  if (end < total) {
    return fetchRange(start, end);
  }

  // Wrap-around when near the end
  const first = await fetchRange(start, total - 1);
  const remaining = end - total + 1;
  const second = remaining > 0 ? await fetchRange(0, remaining - 1) : [];
  return [...first, ...second].slice(0, batchSize);
}

async function processSingleArtistName(name: string): Promise<void> {
  if (!name || name.length < MIN_PREFIX_LENGTH) return;
  try {
    const payload = await musicSearch(name);
    await indexSuggestFromSearch(name, payload);
  } catch (err) {
    console.error("[suggest-indexer] daily_batch_artist_failed", {
      name,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

export async function runDailyArtistSuggestBatch(config: SuggestBatchConfig = {}): Promise<void> {
  const batchSize = config.batchSize || DAILY_BATCH_SIZE;
  const delayMs = config.delayBetweenArtistsMs ?? DEFAULT_DELAY_BETWEEN_ARTISTS_MS;

  const artists = await fetchArtistBatch(batchSize);
  if (!artists.length) {
    console.log("[suggest-indexer] daily_batch_empty");
    return;
  }

  console.log("[suggest-indexer] daily_batch_start", { size: artists.length, delayMs });

  for (const row of artists) {
    const name = pickArtistName(row);
    if (!name) continue;

    await processSingleArtistName(name);

    if (delayMs > 0) await sleep(delayMs);
  }

  console.log("[suggest-indexer] daily_batch_complete", { processed: artists.length });
}

export const DAILY_ARTIST_SUGGEST_CRON = DAILY_BATCH_CRON;
