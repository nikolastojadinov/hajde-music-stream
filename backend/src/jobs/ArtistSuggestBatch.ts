import type { SupabaseClient } from '@supabase/supabase-js';

import { getSupabaseAdmin } from '../services/supabaseClient';

const JOB_LOG_CONTEXT = '[ArtistSuggestBatch]';
const INDEXER_LOG_CONTEXT = '[suggest-indexer]';
export const DAILY_ARTIST_SUGGEST_CRON = '*/5 7-20 * * *';

const BATCH_LIMIT = 50;
const PROCESSED_PAGE_SIZE = 1000;
const SOURCE_TAG = 'artist_indexer';
const MIN_PREFIX_LENGTH = 2;
const MAX_PREFIX_LENGTH = 120;
const ENTITY_TYPES = ['artist', 'album', 'playlist', 'track'] as const;

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
  artist_channel_id: string;
  entity_type: (typeof ENTITY_TYPES)[number];
}

interface SuggestQueryRow {
  artist_channel_id: string;
}

function normalizeQuery(value: string | null | undefined): string {
  if (!value) return '';
  return value
    .toString()
    .trim()
    .toLowerCase()
    .normalize('NFKD')
    .replace(/\p{Diacritic}+/gu, '');
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

function buildRows(prefixes: string[], channelId: string, normalizedName: string, seenAt: string): SuggestEntryRow[] {
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
          endpointType: 'browse',
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

async function countRemainingCandidates(client: SupabaseClient): Promise<number | null> {
  const { count, error } = await client
    .from('artists')
    .select('youtube_channel_id,suggest_queries!left(artist_channel_id)', { count: 'exact', head: true })
    .not('youtube_channel_id', 'is', null)
    .neq('youtube_channel_id', '')
    .is('suggest_queries.artist_channel_id', null);

  if (error) {
    console.error(`${JOB_LOG_CONTEXT} count_remaining_failed`, { message: error.message });
    return null;
  }

  return count ?? null;
}

async function fetchAllProcessedChannelIds(client: SupabaseClient): Promise<Set<string>> {
  const processed = new Set<string>();
  let offset = 0;

  while (true) {
    const { data, error } = await client
      .from('suggest_queries')
      .select('artist_channel_id')
      .order('artist_channel_id', { ascending: true })
      .range(offset, offset + PROCESSED_PAGE_SIZE - 1);

    if (error) {
      console.error(`${JOB_LOG_CONTEXT} processed_channels_fetch_failed`, { message: error.message });
      break;
    }

    const rows = (data || []) as SuggestQueryRow[];
    for (const row of rows) {
      if (row.artist_channel_id) processed.add(row.artist_channel_id);
    }

    if (rows.length < PROCESSED_PAGE_SIZE) break;
    offset += PROCESSED_PAGE_SIZE;
  }

  console.log(`${JOB_LOG_CONTEXT} processed_channels_loaded`, { count: processed.size });
  return processed;
}

async function fetchCandidatesWithJoin(
  client: SupabaseClient,
  limit: number
): Promise<{ rows: ArtistRow[]; errorMessage?: string }> {
  const { data, error } = await client
    .from('artists')
    .select(
      'artist_key, artist, display_name, normalized_name, youtube_channel_id, created_at, updated_at, suggest_queries!left(artist_channel_id)'
    )
    .not('youtube_channel_id', 'is', null)
    .neq('youtube_channel_id', '')
    .is('suggest_queries.artist_channel_id', null)
    .order('updated_at', { ascending: true, nullsFirst: false })
    .order('created_at', { ascending: true })
    .limit(limit);

  if (error) {
    const message = error.message || 'unknown_error';
    console.error(`${JOB_LOG_CONTEXT} candidates_select_failed`, { message });
    return { rows: [], errorMessage: message };
  }

  return { rows: (data || []) as ArtistRow[] };
}

async function fetchCandidatesFallback(client: SupabaseClient, limit: number): Promise<ArtistRow[]> {
  console.log(`${JOB_LOG_CONTEXT} fallback_candidates_fetch_start`, { limit });
  const processedSet = await fetchAllProcessedChannelIds(client);

  const { data, error } = await client
    .from('artists')
    .select('artist_key, artist, display_name, normalized_name, youtube_channel_id, created_at, updated_at')
    .not('youtube_channel_id', 'is', null)
    .neq('youtube_channel_id', '')
    .order('updated_at', { ascending: true, nullsFirst: false })
    .order('created_at', { ascending: true })
    .limit(limit * 4);

  if (error) {
    console.error(`${JOB_LOG_CONTEXT} fallback_candidates_fetch_failed`, { message: error.message });
    return [];
  }

  const rows = (data || []) as ArtistRow[];
  const filtered = rows.filter((row) => {
    const channelId = row.youtube_channel_id?.trim();
    return channelId && !processedSet.has(channelId);
  });

  console.log(`${JOB_LOG_CONTEXT} fallback_candidates_filtered`, {
    fetched: rows.length,
    filtered: filtered.length,
    limit,
  });

  return filtered.slice(0, limit);
}

async function fetchCandidateArtists(
  client: SupabaseClient,
  limit: number
): Promise<{ rows: ArtistRow[]; errorMessage?: string; usedFallback: boolean }> {
  const { rows, errorMessage } = await fetchCandidatesWithJoin(client, limit);
  if (!errorMessage) return { rows, usedFallback: false };

  const lower = errorMessage.toLowerCase();
  const shouldFallback = lower.includes('relationship') || lower.includes('foreign key') || lower.includes('schema');
  if (!shouldFallback) return { rows: [], errorMessage, usedFallback: false };

  const fallbackRows = await fetchCandidatesFallback(client, limit);
  return { rows: fallbackRows, errorMessage, usedFallback: true };
}

async function insertSuggestEntries(client: SupabaseClient, rows: SuggestEntryRow[]): Promise<{ success: boolean; inserted: number }> {
  if (!rows.length) return { success: false, inserted: 0 };

  const { data, error } = await client
    .from('suggest_entries')
    .upsert(rows, { onConflict: 'source,normalized_query,artist_channel_id,entity_type' })
    .select('id');

  if (error) {
    console.error(`${INDEXER_LOG_CONTEXT} entries_upsert_failed`, { message: error.message });
    return { success: false, inserted: 0 };
  }

  return { success: true, inserted: data?.length ?? 0 };
}

async function markArtistProcessed(client: SupabaseClient, channelId: string): Promise<boolean> {
  const payload = { artist_channel_id: channelId, created_at: new Date().toISOString() };
  const { error } = await client
    .from('suggest_queries')
    .insert(payload, { onConflict: 'artist_channel_id', ignoreDuplicates: true });

  if (error) {
    console.error(`${INDEXER_LOG_CONTEXT} mark_processed_failed`, { channelId, message: error.message });
    return false;
  }

  return true;
}

export async function runArtistSuggestBatch(): Promise<{ processed: number }> {
  const client = getSupabaseAdmin();
  const processed = { count: 0 };

  const totalWithChannel = await countArtistsWithChannel(client);
  if (totalWithChannel !== null) {
    console.log(`${JOB_LOG_CONTEXT} candidates_total`, { total_with_channel: totalWithChannel });
  } else {
    console.log(`${JOB_LOG_CONTEXT} candidates_total`, { status: 'unknown', reason: 'count_failed' });
  }

  const remaining = await countRemainingCandidates(client);
  if (remaining !== null) {
    console.log(`${JOB_LOG_CONTEXT} candidates_remaining`, { remaining });
  } else {
    console.log(`${JOB_LOG_CONTEXT} candidates_remaining`, { status: 'unknown', reason: 'count_failed' });
  }

  const candidateResult = await fetchCandidateArtists(client, BATCH_LIMIT);
  if (candidateResult.usedFallback) {
    console.log(`${JOB_LOG_CONTEXT} fallback_active`, { limit: BATCH_LIMIT });
  }
  if (!candidateResult.rows.length) {
    const reason = candidateResult.errorMessage ? 'candidate_query_failed' : 'no_remaining_candidates';
    console.log(`${INDEXER_LOG_CONTEXT} tick_complete`, { processed: processed.count, reason });
    return { processed: processed.count };
  }

  for (const artist of candidateResult.rows) {
    const channelId = (artist.youtube_channel_id || '').trim();
    if (!channelId) continue;

    const normalizedName = pickNormalizedName(artist);
    if (!normalizedName || normalizedName.length < MIN_PREFIX_LENGTH) {
      await markArtistProcessed(client, channelId);
      processed.count += 1;
      continue;
    }

    const prefixes = buildPrefixes(normalizedName);
    if (!prefixes.length) {
      await markArtistProcessed(client, channelId);
      processed.count += 1;
      continue;
    }

    const rows = buildRows(prefixes, channelId, normalizedName, new Date().toISOString());
    const insertResult = await insertSuggestEntries(client, rows);
    const marked = await markArtistProcessed(client, channelId);

    if (insertResult.success && marked) {
      processed.count += 1;
      console.log(`${INDEXER_LOG_CONTEXT} artist_done`, {
        channelId,
        normalizedName,
        totalPrefixes: prefixes.length,
        insertedCount: insertResult.inserted,
      });
    }
  }

  console.log(`${INDEXER_LOG_CONTEXT} tick_complete`, { processed: processed.count });
  return { processed: processed.count };
}

export async function runArtistSuggestTick(): Promise<void> {
  await runArtistSuggestBatch();
}
