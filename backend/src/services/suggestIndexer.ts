import type { SearchResultItem, SearchResultsPayload } from "../lib/youtubeMusicClient";
import supabase from "./supabaseClient";

type EntityKind = "track" | "artist" | "album" | "playlist";

type SuggestRow = {
  query: string;
  normalized_query: string;
  results: SearchResultItem;
  source: string;
  meta: { entity_type: EntityKind };
  ts: string;
};

const MIN_QUERY_LEN = 2;
const MAX_PREFIXES = 20; // safety cap

function normalizeQuery(input: string): string {
  const lowered = input.toLowerCase().normalize("NFKD");
  const asciiOnly = lowered.replace(/[^\x00-\x7F]+/g, "");
  return asciiOnly.trim().replace(/\s+/g, " ");
}

function prefixes(query: string): string[] {
  const result: string[] = [];
  for (let i = 1; i <= query.length && i <= MAX_PREFIXES; i++) {
    const prefix = query.slice(0, i);
    if (prefix.length >= MIN_QUERY_LEN) result.push(prefix);
  }
  return result;
}

function flattenEntities(
  payload: SearchResultsPayload
): Array<{ kind: EntityKind; item: SearchResultItem }> {
  const { featured, sections } = payload;
  const items: Array<{ kind: EntityKind; item: SearchResultItem }> = [];

  const toKind = (item: SearchResultItem, fallback: EntityKind): EntityKind => {
    if (item.kind === "song") return "track";
    if (item.kind === "artist") return "artist";
    if (item.kind === "album") return "album";
    if (item.kind === "playlist") return "playlist";
    return fallback;
  };

  if (featured) items.push({ kind: toKind(featured, "track"), item: featured });
  sections.songs.forEach((item) => items.push({ kind: toKind(item, "track"), item }));
  sections.artists.forEach((item) => items.push({ kind: toKind(item, "artist"), item }));
  sections.albums.forEach((item) => items.push({ kind: toKind(item, "album"), item }));
  sections.playlists.forEach((item) => items.push({ kind: toKind(item, "playlist"), item }));

  return items;
}

function buildRows(rawQuery: string, payload: SearchResultsPayload): SuggestRow[] {
  const normalized = normalizeQuery(rawQuery);
  if (!normalized || normalized.length < MIN_QUERY_LEN) return [];

  const prefixesList = prefixes(normalized);
  if (prefixesList.length === 0) return [];

  const entities = flattenEntities(payload);
  if (entities.length === 0) return [];

  const now = new Date().toISOString();
  const rows: SuggestRow[] = [];

  for (const prefix of prefixesList) {
    for (const entity of entities) {
      rows.push({
        query: prefix,
        normalized_query: prefix,
        results: entity.item,
        source: payload.source,
        meta: { entity_type: entity.kind },
        ts: now,
      });
    }
  }

  return rows;
}

async function insertSuggestRows(rows: SuggestRow[]): Promise<void> {
  if (!supabase || rows.length === 0) return;

  const CHUNK = 500;
  for (let i = 0; i < rows.length; i += CHUNK) {
    const slice = rows.slice(i, i + CHUNK);
    const { error } = await supabase.from("suggest_entries").insert(slice);
    if (error) {
      console.error("[suggest-indexer] insert failed", error.message);
      return;
    }
  }
}

/**
 * MAIN ENTRY
 * - dedupe by FULL normalized query
 * - only ENTER searches reach this function
 */
export async function indexSuggestFromSearch(
  queryRaw: string,
  payload: SearchResultsPayload
): Promise<void> {
  if (!supabase) return;

  try {
    const normalized = normalizeQuery(queryRaw);
    if (!normalized || normalized.length < MIN_QUERY_LEN) return;

    /**
     * STEP 1:
     * Try to register the full query.
     * If it already exists → ON CONFLICT DO NOTHING
     */
    const { error: insertQueryError, data } = await supabase
      .from("suggest_queries")
      .insert({ normalized_query: normalized })
      .select("normalized_query");

    /**
     * If no row was returned, query already existed → STOP
     */
    if (insertQueryError) {
      console.error("[suggest-indexer] query insert failed", insertQueryError.message);
      return;
    }

    if (!data || data.length === 0) {
      // query already processed before → do NOTHING
      return;
    }

    /**
     * STEP 2:
     * First time this query is seen → build and insert prefixes
     */
    const rows = buildRows(normalized, payload);
    if (rows.length === 0) return;

    await insertSuggestRows(rows);
  } catch (err) {
    console.error("[suggest-indexer] failed", {
      error: err instanceof Error ? err.message : String(err),
    });
  }
}
