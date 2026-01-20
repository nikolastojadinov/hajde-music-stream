import type { SearchResultItem, SearchResultsPayload } from "../lib/youtubeMusicClient";
import { musicSearch } from "../lib/youtubeMusicClient";
import supabase, { getSupabaseAdmin } from "./supabaseClient";

/* =========================
   Constants
========================= */

const MIN_PREFIX_LENGTH = 2;
const MAX_PREFIX_COUNT = 120;
const SOURCE_TAG = "search_result_multi";

const DAILY_BATCH_SIZE = 100;
const WINDOW_START_HOUR = 7;
const WINDOW_END_HOUR = 22;

const JITTER_MIN_MS = 30_000;
const JITTER_MAX_MS = 90_000;

/* =========================
   Types
========================= */

type EntityType = "artist" | "song" | "playlist" | "album";

type CanonicalEntity = {
  entityType: EntityType;
  id: string;
  title: string;
  imageUrl: string | null;
  endpointType: SearchResultItem["endpointType"];
  endpointPayload: string;
  meta: Record<string, string>;
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

type EntityLookupMeta = {
  entityType: EntityType;
  metaIdKey: string;
};

/* =========================
   Utils
========================= */

function normalizeQuery(value: string): string {
  const lowered = (value || "").toString().toLowerCase().normalize("NFKD");
  const stripped = lowered.replace(/\p{Diacritic}+/gu, "");
  return stripped.trim().replace(/\s+/g, " ");
}

function normalizeString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
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

function looksLikeVideoId(value: string): boolean {
  const v = normalizeString(value);
  return /^[A-Za-z0-9_-]{11}$/.test(v);
}

function looksLikeChannelId(value: string): boolean {
  const v = normalizeString(value);
  return /^UC[A-Za-z0-9_-]+$/.test(v);
}

function looksLikePlaylistId(value: string): boolean {
  const v = normalizeString(value);
  return /^(OLAK|PL|VL|RD|UU|LL|MP)[A-Za-z0-9_-]+$/.test(v);
}

function looksLikeAlbumId(value: string): boolean {
  const v = normalizeString(value);
  return /^MPRE[A-Za-z0-9_-]+$/.test(v);
}

function isOfficialArtistCandidate(item: SearchResultItem | null | undefined): item is SearchResultItem & { kind: "artist" } {
  if (!item || item.kind !== "artist") return false;

  const payload = normalizeString(item.endpointPayload || item.id);
  if (!payload) return false;

  const pageType = normalizeString(item.pageType).toUpperCase();
  const titleLower = normalizeString(item.title).toLowerCase();
  const subtitleLower = normalizeString(item.subtitle).toLowerCase();

  const looksProfile = subtitleLower.includes("profile");
  const looksTribute =
    titleLower.includes("tribute") ||
    titleLower.includes("cover") ||
    subtitleLower.includes("tribute") ||
    subtitleLower.includes("cover");

  if (looksProfile || looksTribute) return false;
  if (item.isOfficial === false) return false;
  if (item.isOfficial === true) return true;
  if (pageType.includes("ARTIST")) return true;
  if (looksLikeChannelId(payload)) return true;
  return false;
}

/* =========================
   Entity extraction
========================= */

function toCanonicalArtist(item: SearchResultItem | null | undefined): CanonicalEntity | null {
  if (!isOfficialArtistCandidate(item)) return null;
  const channelId = normalizeString(item.endpointPayload || item.id);
  if (!looksLikeChannelId(channelId)) return null;

  return {
    entityType: "artist",
    id: channelId,
    title: item.title,
    imageUrl: item.imageUrl ?? null,
    endpointType: item.endpointType,
    endpointPayload: channelId,
    meta: {
      entity_type: "artist",
      artist_channel_id: channelId,
    },
  };
}

function toCanonicalSong(item: SearchResultItem | null | undefined): CanonicalEntity | null {
  if (!item || item.kind !== "song") return null;
  const videoId = normalizeString(item.endpointPayload || item.id);
  if (!item.endpointType || item.endpointType !== "watch") return null;
  if (!looksLikeVideoId(videoId)) return null;

  return {
    entityType: "song",
    id: videoId,
    title: item.title || item.subtitle || videoId,
    imageUrl: item.imageUrl ?? null,
    endpointType: "watch",
    endpointPayload: videoId,
    meta: {
      entity_type: "song",
      video_id: videoId,
    },
  };
}

function toCanonicalPlaylist(item: SearchResultItem | null | undefined): CanonicalEntity | null {
  if (!item || item.kind !== "playlist") return null;
  const playlistId = normalizeString(item.endpointPayload || item.id);
  if (!item.endpointType || item.endpointType !== "browse") return null;
  if (!looksLikePlaylistId(playlistId)) return null;

  return {
    entityType: "playlist",
    id: playlistId,
    title: item.title,
    imageUrl: item.imageUrl ?? null,
    endpointType: "browse",
    endpointPayload: playlistId,
    meta: {
      entity_type: "playlist",
      playlist_id: playlistId,
    },
  };
}

function toCanonicalAlbum(item: SearchResultItem | null | undefined): CanonicalEntity | null {
  if (!item || item.kind !== "album") return null;
  const albumId = normalizeString(item.endpointPayload || item.id);
  if (!item.endpointType || item.endpointType !== "browse") return null;
  if (!looksLikeAlbumId(albumId)) return null;

  return {
    entityType: "album",
    id: albumId,
    title: item.title,
    imageUrl: item.imageUrl ?? null,
    endpointType: "browse",
    endpointPayload: albumId,
    meta: {
      entity_type: "album",
      album_id: albumId,
    },
  };
}

function pickFirstEntity(
  lists: Array<Array<SearchResultItem | null | undefined>>,
  mapper: (item: SearchResultItem | null | undefined) => CanonicalEntity | null
): CanonicalEntity | null {
  const seen = new Set<string>();
  for (const list of lists) {
    for (const item of list) {
      const parsed = mapper(item);
      if (!parsed) continue;
      const key = `${parsed.entityType}:${parsed.id}`;
      if (seen.has(key)) continue;
      seen.add(key);
      return parsed;
    }
  }
  return null;
}

function pickTopArtist(payload: SearchResultsPayload): CanonicalEntity | null {
  return pickFirstEntity(
    [[payload.featured], payload.sections?.artists ?? [], payload.orderedItems ?? []],
    toCanonicalArtist
  );
}

function pickTopSong(payload: SearchResultsPayload): CanonicalEntity | null {
  return pickFirstEntity(
    [payload.sections?.songs ?? [], payload.orderedItems ?? []],
    toCanonicalSong
  );
}

function pickTopPlaylist(payload: SearchResultsPayload): CanonicalEntity | null {
  return pickFirstEntity(
    [payload.sections?.playlists ?? [], payload.orderedItems ?? []],
    toCanonicalPlaylist
  );
}

function pickTopAlbum(payload: SearchResultsPayload): CanonicalEntity | null {
  return pickFirstEntity(
    [payload.sections?.albums ?? [], payload.orderedItems ?? []],
    toCanonicalAlbum
  );
}

function extractEntities(payload: SearchResultsPayload): Partial<Record<EntityType, CanonicalEntity>> {
  const artist = pickTopArtist(payload);
  const song = pickTopSong(payload);
  const playlist = pickTopPlaylist(payload);
  const album = pickTopAlbum(payload);

  const map: Partial<Record<EntityType, CanonicalEntity>> = {};
  if (artist) map.artist = artist;
  if (song) map.song = song;
  if (playlist) map.playlist = playlist;
  if (album) map.album = album;
  return map;
}

/* =========================
   DB helpers
========================= */

function toLookupMeta(entity: CanonicalEntity): EntityLookupMeta {
  const metaKey =
    entity.entityType === "artist"
      ? "artist_channel_id"
      : entity.entityType === "song"
      ? "video_id"
      : entity.entityType === "playlist"
      ? "playlist_id"
      : "album_id";

  return { entityType: entity.entityType, metaIdKey: metaKey };
}

async function findExisting(prefix: string, entity: CanonicalEntity): Promise<ExistingRow | null> {
  const { entityType, metaIdKey } = toLookupMeta(entity);

  const { data, error } = await supabase
    .from("suggest_entries")
    .select("id, hit_count")
    .eq("normalized_query", prefix)
    .eq("meta->>entity_type", entityType)
    .eq(`meta->>${metaIdKey}`, entity.id)
    .maybeSingle();

  if (error) {
    throw new Error(`[suggest-indexer] lookup_failed: ${error.message}`);
  }

  return data ?? null;
}

function buildResultPayload(entity: CanonicalEntity) {
  return {
    id: entity.id,
    title: entity.title,
    imageUrl: entity.imageUrl,
    endpointType: entity.endpointType,
    endpointPayload: entity.endpointPayload,
    isOfficial: true,
  };
}

async function upsertPrefix(prefix: string, entity: CanonicalEntity, seenAt: string): Promise<void> {
  const existing = await findExisting(prefix, entity);

  const payload = {
    query: prefix,
    normalized_query: prefix,
    source: SOURCE_TAG,
    results: buildResultPayload(entity),
    meta: entity.meta,
    hit_count: existing?.hit_count ? existing.hit_count + 1 : 1,
    last_seen_at: seenAt,
  };

  if (existing) {
    const { error } = await supabase.from("suggest_entries").update(payload).eq("id", existing.id);
    if (error) throw new Error(`[suggest-indexer] update_failed: ${error.message}`);
    return;
  }

  const { error } = await supabase.from("suggest_entries").insert(payload);
  if (error) throw new Error(`[suggest-indexer] insert_failed: ${error.message}`);
}

/* =========================
   Core logic
========================= */

const ENTITY_ORDER: EntityType[] = ["artist", "song", "playlist", "album"];

async function processSingleArtist(name: string): Promise<void> {
  const normalizedName = normalizeQuery(name);
  if (!normalizedName || normalizedName.length < MIN_PREFIX_LENGTH) return;

  const prefixes = buildPrefixes(normalizedName);
  if (!prefixes.length) return;

  const payload = await musicSearch(name);
  const entities = extractEntities(payload);
  const hasEntity = ENTITY_ORDER.some((key) => Boolean(entities[key]));
  if (!hasEntity) return;

  const seenAt = new Date().toISOString();

  for (const prefix of prefixes) {
    for (const type of ENTITY_ORDER) {
      const entity = entities[type];
      if (!entity) continue;

      try {
        await upsertPrefix(prefix, entity, seenAt);
      } catch (err) {
        console.error("[suggest-indexer] upsert_failed", {
          prefix,
          entity: entity.entityType,
          id: entity.id,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
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
    console.error("[suggest-indexer] artist_fetch_failed", error.message);
    return [];
  }

  return data ?? [];
}

/* =========================
   Distributed daily run
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
