import type { SupabaseClient } from '@supabase/supabase-js';

import { musicSearch } from '../services/youtubeMusicClient';
import { getSupabaseAdmin } from '../services/supabaseClient';

const JOB_LOG_CONTEXT = '[ArtistSuggestBatch]';
const INDEXER_LOG_CONTEXT = '[suggest-indexer]';
export const ARTIST_SUGGEST_CRON = '* * * * *';

const BATCH_LIMIT = 1;
const SOURCE_TAG = 'artist_indexer';
const MIN_PREFIX_LENGTH = 2;
const MAX_PREFIX_LENGTH = 120;
const ENTITY_TYPES = ['artist', 'album', 'playlist', 'track'] as const;

type SuggestEntityType = (typeof ENTITY_TYPES)[number];
type SuggestEndpointType = 'browse' | 'watch' | 'watchPlaylist';

interface ArtistRow {
  artist_key: string;
  artist: string | null;
  display_name: string | null;
  normalized_name: string | null;
  created_at?: string | null;
  updated_at?: string | null;
  youtube_channel_id: string | null;
}

interface SuggestEntryRow {
  query: string;
  normalized_query: string;
  source: string;
  results: Record<string, unknown>;
  meta: Record<string, unknown>;
  hit_count: number;
  last_seen_at: string;
  artist_channel_id: string | null;
  entity_type: SuggestEntityType;
  external_id: string;
}

type PrefixEntity = {
  type: SuggestEntityType;
  external_id: string;
  title: string;
  endpointType: SuggestEndpointType;
  endpointPayload: string;
};

type PrefixEntityMap = Partial<Record<SuggestEntityType, PrefixEntity>>;

const VALID_ID_PATTERNS: Record<SuggestEntityType, RegExp> = {
  artist: /^UC[a-zA-Z0-9_-]+$/,
  album: /^MPREb[a-zA-Z0-9_-]+$/,
  playlist: /^PL[a-zA-Z0-9_-]+$/,
  track: /^[a-zA-Z0-9_-]{11}$/,
};

function normalizeQuery(value: string | null | undefined): string {
  if (!value) return '';
  return value
    .toString()
    .trim()
    .toLowerCase()
    .normalize('NFKD')
    .replace(/\p{Diacritic}+/gu, '');
}

function normalizeValue(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
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

function isValidExternalId(type: SuggestEntityType, id: string): boolean {
  const pattern = VALID_ID_PATTERNS[type];
  return pattern.test(id);
}

async function fetchPrefixEntities(prefix: string): Promise<PrefixEntityMap> {
  const entities: PrefixEntityMap = {};
  const seenIds = new Set<string>();

  const addEntity = (
    type: SuggestEntityType,
    idRaw: string | null | undefined,
    titleRaw: string | null | undefined,
    endpointType: SuggestEndpointType,
    endpointPayloadRaw?: string | null,
  ): void => {
    const externalId = normalizeValue(idRaw);
    const title = normalizeValue(titleRaw);
    const endpointPayload = normalizeValue(endpointPayloadRaw) || externalId;
    if (!externalId || !title) return;
    if (!isValidExternalId(type, externalId)) return;
    if (seenIds.has(externalId)) return;
    seenIds.add(externalId);
    entities[type] = {
      type,
      external_id: externalId,
      title,
      endpointType,
      endpointPayload,
    };
  };

  try {
    const searchResults = await musicSearch(prefix);

    const topArtist = Array.isArray(searchResults.artists)
      ? searchResults.artists.find((artist) => isValidExternalId('artist', normalizeValue(artist?.id)))
      : null;
    if (topArtist) {
      addEntity('artist', topArtist.id, topArtist.name, 'browse', topArtist.id);
    }

    const topAlbum = Array.isArray(searchResults.albums)
      ? searchResults.albums.find((album) => isValidExternalId('album', normalizeValue(album?.id)))
      : null;
    if (topAlbum) {
      addEntity('album', topAlbum.id, topAlbum.title, 'browse', topAlbum.id);
    }

    const topPlaylist = Array.isArray(searchResults.playlists)
      ? searchResults.playlists.find((playlist) => isValidExternalId('playlist', normalizeValue(playlist?.id)))
      : null;
    if (topPlaylist) {
      addEntity('playlist', topPlaylist.id, topPlaylist.title, 'watchPlaylist', topPlaylist.id);
    }

    const topTrack = Array.isArray(searchResults.tracks)
      ? searchResults.tracks.find((track) => isValidExternalId('track', normalizeValue(track?.youtubeId)))
      : null;
    if (topTrack) {
      addEntity('track', topTrack.youtubeId, topTrack.title, 'watch', topTrack.youtubeId);
    }
  } catch (err) {
    console.error(`${INDEXER_LOG_CONTEXT} prefix_fetch_failed`, {
      prefix,
      message: err instanceof Error ? err.message : String(err),
    });
  }

  return entities;
}

function buildRowsFromEntities(
  prefix: string,
  entities: PrefixEntityMap,
  artistChannelId: string,
  seenAt: string,
): SuggestEntryRow[] {
  const rows: SuggestEntryRow[] = [];
  const uniqueIds = new Set<string>();

  for (const type of ENTITY_TYPES) {
    const entity = entities[type];
    if (!entity) continue;
    if (uniqueIds.has(entity.external_id)) continue;
    uniqueIds.add(entity.external_id);

    rows.push({
      query: prefix,
      normalized_query: prefix,
      source: SOURCE_TAG,
      results: {
        type: entity.type,
        title: entity.title,
        endpointType: entity.endpointType,
        endpointPayload: entity.endpointPayload,
      },
      meta: { entity_type: entity.type, external_id: entity.external_id },
      hit_count: 1,
      last_seen_at: seenAt,
      artist_channel_id: entity.type === 'artist' ? artistChannelId : null,
      entity_type: entity.type,
      external_id: entity.external_id,
    });
  }

  return rows;
}

async function countArtistsWithChannel(client: SupabaseClient): Promise<number | null> {
  const { count, error } = await client
    .from('artists')
    .select('youtube_channel_id', { count: 'exact', head: true })
    .not('youtube_channel_id', 'is', null)
    .neq('youtube_channel_id', '');

  if (error) {
    console.error(`${JOB_LOG_CONTEXT} count_total_failed`, { message: error.message });
    return null;
  }

  return count ?? null;
}

async function countQueuedSuggestions(client: SupabaseClient): Promise<number | null> {
  const { count, error } = await client
    .from('suggest_queries')
    .select('artist_channel_id', { count: 'exact', head: true });

  if (error) {
    console.error(`${JOB_LOG_CONTEXT} count_queued_failed`, { message: error.message });
    return null;
  }

  return count ?? null;
}

async function fetchArtistSuggestCandidates(client: SupabaseClient, limit: number): Promise<ArtistRow[]> {
  const { data, error } = await client.rpc('fetch_artist_suggest_candidates', { limit_count: limit });

  if (error) {
    console.error(`${JOB_LOG_CONTEXT} candidates_select_failed`, { message: error.message });
    return [];
  }

  return (data || []) as ArtistRow[];
}

async function findExistingEntries(
  client: SupabaseClient,
  prefix: string,
  rows: SuggestEntryRow[],
): Promise<number> {
  if (!rows.length) return 0;

  const externalIds = Array.from(new Set(rows.map((row) => row.external_id)));
  const entityTypes = Array.from(new Set(rows.map((row) => row.entity_type)));

  const { data, error } = await client
    .from('suggest_entries')
    .select('external_id', { head: false })
    .eq('source', SOURCE_TAG)
    .eq('normalized_query', prefix)
    .in('external_id', externalIds)
    .in('entity_type', entityTypes);

  if (error) {
    console.error(`${INDEXER_LOG_CONTEXT} find_existing_failed`, { prefix, message: error.message });
    return 0;
  }

  return data?.length ?? 0;
}

async function upsertSuggestEntries(
  client: SupabaseClient,
  prefix: string,
  rows: SuggestEntryRow[],
): Promise<{ success: boolean; insertedNew: number; skippedExisting: number; attempted: number }> {
  if (!rows.length) return { success: true, insertedNew: 0, skippedExisting: 0, attempted: 0 };

  const existingCount = await findExistingEntries(client, prefix, rows);
  const { error } = await client
    .from('suggest_entries')
    .upsert(rows, {
      onConflict: 'source,normalized_query,entity_type,external_id',
      returning: 'minimal',
    });

  if (error) {
    console.error(`${INDEXER_LOG_CONTEXT} entries_upsert_failed`, { prefix, message: error.message });
    return { success: false, insertedNew: 0, skippedExisting: 0, attempted: rows.length };
  }

  const insertedNew = Math.max(rows.length - existingCount, 0);
  return { success: true, insertedNew, skippedExisting: existingCount, attempted: rows.length };
}

async function markArtistsProcessed(
  client: SupabaseClient,
  channelIds: string[],
): Promise<{ success: boolean; inserted: number; skipped: number }> {
  const uniqueChannelIds = Array.from(new Set(channelIds.map((id) => id.trim()).filter(Boolean)));
  if (!uniqueChannelIds.length) return { success: true, inserted: 0, skipped: 0 };

  const now = new Date().toISOString();
  const payload = uniqueChannelIds.map((artist_channel_id) => ({ artist_channel_id, created_at: now }));

  const { count, error } = await client
    .from('suggest_queries')
    .insert(payload, { ignoreDuplicates: true, returning: 'minimal', count: 'exact' });

  if (error) {
    console.error(`${INDEXER_LOG_CONTEXT} mark_processed_failed`, { message: error.message });
    return { success: false, inserted: 0, skipped: 0 };
  }

  const inserted = count ?? 0;
  const skipped = Math.max(uniqueChannelIds.length - inserted, 0);
  console.log(`${INDEXER_LOG_CONTEXT} mark_processed`, {
    inserted_new: inserted,
    skipped_existing: skipped,
  });

  return { success: true, inserted, skipped };
}

export async function runArtistSuggestBatch(): Promise<{ processed: number }> {
  const client = getSupabaseAdmin();
  const readyToMark: string[] = [];
  let processedAttempted = 0;
  let prefixesGenerated = 0;
  let insertedNewTotal = 0;
  let skippedExistingTotal = 0;

  const totalWithChannel = await countArtistsWithChannel(client);
  if (totalWithChannel !== null) {
    console.log(`${JOB_LOG_CONTEXT} candidates_total_with_channel`, { total_with_channel: totalWithChannel });
  } else {
    console.log(`${JOB_LOG_CONTEXT} candidates_total_with_channel`, { status: 'unknown', reason: 'count_failed' });
  }

  const alreadyQueued = await countQueuedSuggestions(client);
  if (alreadyQueued !== null) {
    console.log(`${JOB_LOG_CONTEXT} candidates_already_queued`, { queued: alreadyQueued });
  } else {
    console.log(`${JOB_LOG_CONTEXT} candidates_already_queued`, { status: 'unknown', reason: 'count_failed' });
  }

  const candidates = await fetchArtistSuggestCandidates(client, BATCH_LIMIT);
  console.log(`${JOB_LOG_CONTEXT} candidates_new`, { count: candidates.length, limit: BATCH_LIMIT });

  if (!candidates.length) {
    console.log(`${INDEXER_LOG_CONTEXT} tick_complete`, {
      candidates_new: 0,
      processed_attempted: 0,
      prefixes_generated: 0,
      inserted_new_total: 0,
      skipped_existing_total: 0,
      reason: 'no_remaining_candidates',
    });
    return { processed: 0 };
  }

  const candidate = candidates[0];
  const channelId = normalizeValue(candidate.youtube_channel_id);
  if (channelId) {
    processedAttempted = 1;
  } else {
    console.log(`${INDEXER_LOG_CONTEXT} artist_skipped_missing_channel`, { artist_key: candidate.artist_key });
  }

  if (channelId) {
    const normalizedName = pickNormalizedName(candidate);
    if (!normalizedName || normalizedName.length < MIN_PREFIX_LENGTH) {
      readyToMark.push(channelId);
      console.log(`${INDEXER_LOG_CONTEXT} artist_skipped_short_name`, { channelId, normalizedName });
    } else {
      const prefixes = buildPrefixes(normalizedName);
      prefixesGenerated = prefixes.length;
      const seenAt = new Date().toISOString();

      for (const prefix of prefixes) {
        const entities = await fetchPrefixEntities(prefix);
        const rows = buildRowsFromEntities(prefix, entities, channelId, seenAt);

        if (!rows.length) {
          console.log(`${INDEXER_LOG_CONTEXT} prefix_no_entities`, { prefix, channelId });
          continue;
        }

        const upsertResult = await upsertSuggestEntries(client, prefix, rows);
        if (upsertResult.success) {
          insertedNewTotal += upsertResult.insertedNew;
          skippedExistingTotal += upsertResult.skippedExisting;
        }

        const insertedEntities = {
          artist: Boolean(rows.find((r) => r.entity_type === 'artist')),
          album: Boolean(rows.find((r) => r.entity_type === 'album')),
          playlist: Boolean(rows.find((r) => r.entity_type === 'playlist')),
          track: Boolean(rows.find((r) => r.entity_type === 'track')),
        };

        console.log(`${INDEXER_LOG_CONTEXT} prefix_processed`, {
          prefix,
          channelId,
          attempted: upsertResult.attempted,
          inserted_new: upsertResult.insertedNew,
          skipped_existing: upsertResult.skippedExisting,
          inserted_entities: insertedEntities,
        });
      }

      readyToMark.push(channelId);
    }
  }

  const markResult = await markArtistsProcessed(client, readyToMark);

  console.log(`${INDEXER_LOG_CONTEXT} tick_complete`, {
    candidates_new: candidates.length,
    processed_attempted: processedAttempted,
    prefixes_generated: prefixesGenerated,
    inserted_new_total: insertedNewTotal,
    skipped_existing_total: skippedExistingTotal,
    mark_inserted: markResult.inserted,
    mark_skipped_existing: markResult.skipped,
  });

  return { processed: processedAttempted };
}

export async function runArtistSuggestTick(): Promise<void> {
  await runArtistSuggestBatch();
}
