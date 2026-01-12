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
const MAX_PREFIXES = 20; // protects from excessively long inputs

function normalizeQuery(input: string): string {
  const ascii = input
    .normalize("NFKD")
    .replace(/[^\p{ASCII}]/gu, "");
  return ascii.toLowerCase().trim().replace(/\s+/g, " ");
}

function prefixes(query: string): string[] {
  const result: string[] = [];
  for (let i = 1; i <= query.length && i <= MAX_PREFIXES; i++) {
    const prefix = query.slice(0, i);
    if (prefix.length >= MIN_QUERY_LEN) result.push(prefix);
  }
  return result;
}

function flattenEntities(payload: SearchResultsPayload): Array<{ kind: EntityKind; item: SearchResultItem }> {
  const { featured, sections } = payload;
  const items: Array<{ kind: EntityKind; item: SearchResultItem }> = [];

  if (featured) items.push({ kind: "track", item: featured });
  sections.songs.forEach((item) => items.push({ kind: "track", item }));
  sections.artists.forEach((item) => items.push({ kind: "artist", item }));
  sections.albums.forEach((item) => items.push({ kind: "album", item }));
  sections.playlists.forEach((item) => items.push({ kind: "playlist", item }));

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

async function insertRows(rows: SuggestRow[]): Promise<void> {
  if (!supabase) return;
  const CHUNK = 500;

  for (let i = 0; i < rows.length; i += CHUNK) {
    const slice = rows.slice(i, i + CHUNK);
    const { error } = await supabase.from("suggest_entries").insert(slice);
    if (error) {
      console.error("[suggest-indexer] insert failed", { error: error.message });
      return;
    }
  }
}

export async function indexSuggestFromSearch(queryRaw: string, payload: SearchResultsPayload): Promise<void> {
  try {
    const rows = buildRows(queryRaw, payload);
    if (rows.length === 0) return;
    await insertRows(rows);
  } catch (err) {
    console.error("[suggest-indexer] failed", { error: err instanceof Error ? err.message : String(err) });
  }
}
