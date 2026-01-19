import type { SearchResultItem, SearchResultsPayload } from "../lib/youtubeMusicClient";
import { musicSearch } from "../lib/youtubeMusicClient";
import supabase, { getSupabaseAdmin } from "./supabaseClient";

/* =========================
   Constants
========================= */

const MIN_PREFIX_LENGTH = 2;
const SOURCE_TAG = "search_result_artist";
const MAX_PREFIX_COUNT = 120;

const DAILY_BATCH_SIZE = 100;
const WINDOW_START_HOUR = 7;
const WINDOW_END_HOUR = 22;

const JITTER_MIN_MS = 30_000;
const JITTER_MAX_MS = 90_000;

/* =========================
   Types
========================= */

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

type ArtistRow = {
  artist_key: string;
  artist: string | null;
  display_name: string | null;
  normalized_name: string | null;
  created_at: string | null;
};

/* =========================
   Utils
========================= */

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

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function jitter(): number {
  return JITTER_MIN_MS + Math.floor(Math.random() * (JITTER_MAX_MS - JITTER_MIN_MS));
}

function now(): number {
  return Date.now();
}

function todayAt(hour: number): number {
  const d = new Date();
  d.setHours(hour, 0, 0, 0);
  return d.getTime();
}

/* =========================
   Artist extraction
========================= */

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
  const lists: Array<Array<SearchResultItem | null | undefined>> = [
    [payload.featured],
    payload.sections?.artists ?? [],
    payload.orderedItems ?? [],
  ];

  const seen = new Set<string>();
  for (const list of lists) {
    for (const item of list) {
      const artist = toCanonicalArtist(item);
      if (!artist) continue;
      if (seen.has(artist.channelId)) continue;
      seen.add(artist.channelId);
      return artist;
    }
  }
  return null;
}

/* =========================
   DB helpers
========================= */

async function findExisting(prefix: string, channelId: string): Promise<ExistingRow | null> {
  const { data, error } = await supabase
    .from("suggest_entries")
    .select("id, hit_count")
    .eq("normalized_query", prefix)
    .eq("meta->>artist_channel_id", channelId)
    .maybeSingle();

  if (error) {
    throw new Error(`[suggest-indexer] lookup failed: ${error.message}`);
  }

  return data ?? null;
}

async function upsertPrefix(prefix: string, artist: CanonicalArtist, seenAt: string): Promise<void> {
  const existing = await findExisting(prefix, artist.channelId);

  const payload = {
    query: prefix,
    normalized_query: prefix,
    source: SOURCE_TAG,
    results: {
      id: artist.id,
      channelId: artist.channelId,
      name: artist.name,
      subtitle: artist.subtitle,
      imageUrl: artist.imageUrl,
      endpointType: artist.endpointType,
      endpointPayload: artist.endpointPayload,
      pageType: artist.pageType,
      isOfficial: true,
    },
    meta: {
      entity_type: "artist",
      artist_channel_id: artist.channelId,
      artist_page_type: artist.pageType ?? null,
    },
    hit_count: existing?.hit_count ? existing.hit_count + 1 : 1,
    last_seen_at: seenAt,
  };

  if (existing) {
    const { error } = await supabase.from("suggest_entries").update(payload).eq("id", existing.id);
    if (error) throw new Error(`[suggest-indexer] update failed: ${error.message}`);
    return;
  }

  const { error } = await supabase.from("suggest_entries").insert(payload);
  if (error) throw new Error(`[suggest-indexer] insert failed: ${error.message}`);
}

/* =========================
   Core logic
========================= */

async function processSingleArtist(name: string): Promise<void> {
  if (!name || name.length < MIN_PREFIX_LENGTH) return;

  const payload = await musicSearch(name);
  const artist = pickTopOfficialArtist(payload);
  if (!artist) return;

  const normalized = normalizeQuery(name);
  const prefixes = buildPrefixes(normalized);
  if (!prefixes.length) return;

  const seenAt = new Date().toISOString();

  for (const prefix of prefixes) {
    await upsertPrefix(prefix, artist, seenAt);
  }
}

function pickArtistName(row: ArtistRow): string {
  return (
    normalizeQuery(row.display_name || "") ||
    normalizeQuery(row.artist || "") ||
    normalizeQuery(row.normalized_name || "") ||
    normalizeQuery(row.artist_key || "")
  );
}

async function fetchArtistBatch(limit: number): Promise<ArtistRow[]> {
  const client = getSupabaseAdmin();

  const { data, error } = await client
    .from("artists")
    .select("artist_key, artist, display_name, normalized_name, created_at")
    .order("created_at", { ascending: true })
    .order("artist_key", { ascending: true })
    .limit(limit);

  if (error) {
    console.error("[suggest-indexer] artist fetch failed", error.message);
    return [];
  }

  return data ?? [];
}

/* =========================
   DISTRIBUTED DAILY RUN
========================= */

export async function runDailyArtistSuggestBatch(): Promise<void> {
  const startWindow = todayAt(WINDOW_START_HOUR);
  const windowEnd = todayAt(WINDOW_END_HOUR);
  const startTs = now();

  if (startTs >= windowEnd) {
    console.log("[suggest-indexer] distributed_window_missed", { startTs });
    return;
  }

  const artists = await fetchArtistBatch(DAILY_BATCH_SIZE);
  if (!artists.length) {
    console.log("[suggest-indexer] distributed_empty_batch");
    return;
  }

  console.log("[suggest-indexer] distributed_start", {
    artists: artists.length,
    windowStart: new Date(startWindow).toISOString(),
    windowEnd: new Date(windowEnd).toISOString(),
  });

  let index = 0;

  while (index < artists.length && now() < windowEnd) {
    const row = artists[index++];
    const name = pickArtistName(row);

    if (name) {
      try {
        await processSingleArtist(name);
        console.log("[suggest-indexer] artist_done", { index, name });
      } catch (err) {
        console.error("[suggest-indexer] artist_failed", {
          name,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    if (index >= artists.length) break;

    const remaining = artists.length - index;
    const remainingTime = windowEnd - now();
    if (remainingTime <= 0) break;

    const baseDelay = Math.max(Math.floor(remainingTime / remaining), 0);
    const delay = baseDelay + jitter();
    await sleep(delay);
  }

  if (now() >= windowEnd && index < artists.length) {
    console.log("[suggest-indexer] distributed_cutoff_reached", { processed: index });
    return;
  }

  console.log("[suggest-indexer] distributed_complete", { processed: index });
}

/* =========================
   Cron export
========================= */

export const DAILY_ARTIST_SUGGEST_CRON = "0 7 * * *";
