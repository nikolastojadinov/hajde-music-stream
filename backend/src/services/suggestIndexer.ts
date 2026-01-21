import type { SearchResultItem, SearchResultsPayload } from "../lib/youtubeMusicClient";
import { musicSearch } from "../lib/youtubeMusicClient";
import supabase, { getSupabaseAdmin } from "./supabaseClient";

/* =========================
   Constants
========================= */

const MIN_PREFIX_LENGTH = 2;
const MAX_PREFIX_COUNT = 120;
const SOURCE_TAG = "search_result_multi";

const WINDOW_START_HOUR = 7;
const WINDOW_END_HOUR = 22;

const PER_RUN_TARGET = 1; // exactly one artist per tick
const CANDIDATE_SCAN_LIMIT = 25; // scan window to find next unprocessed artist

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
  youtube_channel_id?: string | null;
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

function now(): number {
  return Date.now();
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

async function runJsonQuery<T>(sql: string, label: string): Promise<T | null> {
  const client = getSupabaseAdmin();
  const { data, error } = await client.rpc("run_raw_single", { sql });

  if (error) throw new Error(`[suggest-indexer] ${label} failed: ${error.message}`);
  if (!Array.isArray(data) || data.length === 0) return null;

  const payload = (data[0] as any)?.payload;
  if (payload === null || payload === undefined) return null;
  return payload as T;
}

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
    .eq(`meta->>${metaIdKey}` as any, entity.id)
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

async function fetchArtistBatch(limit: number, offset = 0): Promise<ArtistRow[]> {
  const sql = `
SELECT
  a.artist_key,
  a.artist,
  a.display_name,
  a.normalized_name,
  a.created_at,
  a.youtube_channel_id
FROM artists a
WHERE a.youtube_channel_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1
    FROM suggest_queries sq
    WHERE sq.artist_channel_id = a.youtube_channel_id
  )
ORDER BY a.created_at ASC, a.artist_key ASC
LIMIT ${limit}
OFFSET ${offset};
`;

  try {
    const rows = await runJsonQuery<ArtistRow[]>(sql, "fetchArtistBatch");
    return rows || [];
  } catch (err) {
    console.error("[suggest-indexer] artist_fetch_failed", err instanceof Error ? err.message : String(err));
    return [];
  }
}

function isWithinWindow(nowTs: number): boolean {
  const nowDate = new Date(nowTs);
  const hour = nowDate.getHours();
  if (WINDOW_START_HOUR <= WINDOW_END_HOUR) {
    return hour >= WINDOW_START_HOUR && hour < WINDOW_END_HOUR;
  }
  return hour >= WINDOW_START_HOUR || hour < WINDOW_END_HOUR;
}

async function artistAlreadyIndexed(channelId: string): Promise<boolean> {
  if (!channelId) return true;
  const { data, error } = await supabase
    .from("suggest_queries")
    .select("artist_channel_id")
    .eq("artist_channel_id", channelId)
    .limit(1)
    .maybeSingle();

  if (error && error.code !== "PGRST116") {
    console.error("[suggest-indexer] artist_exists_check_failed", error.message);
    return true;
  }

  return Boolean(data);
}

async function markArtistProcessed(channelId: string, normalizedName: string): Promise<void> {
  if (!channelId) return;
  const payload = {
    artist_channel_id: channelId,
    normalized_query: normalizedName || channelId,
    created_at: new Date().toISOString(),
  };

  const { error } = await supabase
    .from("suggest_queries")
    .upsert(payload, { onConflict: "artist_channel_id" });

  if (error) throw new Error(`[suggest-indexer] mark_processed_failed: ${error.message}`);
}

export async function runArtistSuggestTick(): Promise<void> {
  const nowTs = now();
  if (!isWithinWindow(nowTs)) {
    console.log("[suggest-indexer] window_skip", { hour: new Date(nowTs).getHours() });
    return;
  }

  let processed = 0;
  let offset = 0;
  let scanned = 0;

  while (processed < PER_RUN_TARGET) {
    const candidates = await fetchArtistBatch(CANDIDATE_SCAN_LIMIT, offset);
    if (!candidates.length) {
      if (scanned === 0) console.log("[suggest-indexer] empty_candidate_batch");
      break;
    }

    scanned += candidates.length;
    offset += CANDIDATE_SCAN_LIMIT;

    for (const row of candidates) {
      if (processed >= PER_RUN_TARGET) break;
      const channelId = normalizeString(row.youtube_channel_id || "");
      if (!channelId) continue;

      const alreadyIndexed = await artistAlreadyIndexed(channelId);
      if (alreadyIndexed) continue;

      const name = pickArtistName(row);
      if (!name) continue;

      try {
        await processSingleArtist(name);
        await markArtistProcessed(channelId, name);
        processed += 1;
        console.log("[suggest-indexer] artist_done", { name, processed });
      } catch (err) {
        console.error("[suggest-indexer] artist_failed", {
          name,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    if (candidates.length < CANDIDATE_SCAN_LIMIT) break;
  }

  console.log("[suggest-indexer] tick_complete", { processed });
}

/* =========================
   Cron export
========================= */

export const DAILY_ARTIST_SUGGEST_CRON = "*/5 * * * *";
