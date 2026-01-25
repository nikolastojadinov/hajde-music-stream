import type { SupabaseClient } from '@supabase/supabase-js';

import { getSupabaseAdmin } from '../services/supabaseClient';

const JOB_LOG_CONTEXT = '[ArtistSuggestBatch]';
const INDEXER_LOG_CONTEXT = '[suggest-indexer]';
export const DAILY_ARTIST_SUGGEST_CRON = '*/5 7-20 * * *';

const BATCH_LIMIT = 50;
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

async function countRemainingCandidates(client: SupabaseClient): Promise<number | null> {
  const { count, error } = await client
    .from('artists')
    .select('youtube_channel_id', { count: 'exact', head: true })
    .not('youtube_channel_id', 'is', null)
    .neq('youtube_channel_id', '')
    .not('youtube_channel_id', 'in', '(select artist_channel_id from suggest_queries)');

  if (error) {
    console.error(`${JOB_LOG_CONTEXT} count_remaining_failed`, { message: error.message });
    return null;
  }

  return count ?? null;
}

async function fetchCandidateArtists(client: SupabaseClient, limit: number): Promise<ArtistRow[]> {
  const { data, error } = await client
    .from('artists')
    .select('artist_key, artist, display_name, normalized_name, youtube_channel_id, created_at, updated_at')
    .not('youtube_channel_id', 'is', null)
    .neq('youtube_channel_id', '')
    .not('youtube_channel_id', 'in', '(select artist_channel_id from suggest_queries)')
    .order('updated_at', { ascending: true, nullsFirst: false })
    .order('created_at', { ascending: true })
    .limit(limit);

  if (error) {
    console.error(`${JOB_LOG_CONTEXT} candidates_select_failed`, { message: error.message });
    return [];
  }

  return (data || []) as ArtistRow[];
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

async function markArtistsProcessed(
  client: SupabaseClient,
  channelIds: string[],
): Promise<{ success: boolean; inserted: number; skipped: number }> {
  const uniqueChannelIds = Array.from(new Set(channelIds.map((id) => id.trim()).filter(Boolean)));
  if (!uniqueChannelIds.length) return { success: true, inserted: 0, skipped: 0 };

  const now = new Date().toISOString();
  const payload = uniqueChannelIds.map((artist_channel_id) => ({ artist_channel_id, created_at: now }));

  const { data, error } = await client
    .from('suggest_queries')
    .upsert(payload, { onConflict: 'artist_channel_id', ignoreDuplicates: true })
    .select('artist_channel_id');

  if (error) {
    console.error(`${INDEXER_LOG_CONTEXT} mark_processed_failed`, { message: error.message });
    return { success: false, inserted: 0, skipped: 0 };
  }

  const inserted = data?.length ?? 0;
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

  const remaining = await countRemainingCandidates(client);
  if (remaining !== null) {
    console.log(`${JOB_LOG_CONTEXT} candidates_remaining`, { remaining });
  } else {
    console.log(`${JOB_LOG_CONTEXT} candidates_remaining`, { status: 'unknown', reason: 'count_failed' });
  }

  const candidates = await fetchCandidateArtists(client, BATCH_LIMIT);
  console.log(`${JOB_LOG_CONTEXT} candidates_new`, { count: candidates.length, limit: BATCH_LIMIT });

  if (!candidates.length) {
    console.log(`${INDEXER_LOG_CONTEXT} tick_complete`, {
      processed_attempted: 0,
      inserted_new: 0,
      skipped_existing: 0,
      reason: 'no_remaining_candidates',
    });
    return { processed: 0 };
  }

  for (const artist of candidates) {
    const channelId = (artist.youtube_channel_id || '').trim();
    if (!channelId) continue;
    processedAttempted += 1;

    const normalizedName = pickNormalizedName(artist);
    if (!normalizedName || normalizedName.length < MIN_PREFIX_LENGTH) {
      readyToMark.push(channelId);
      console.log(`${INDEXER_LOG_CONTEXT} artist_skipped_short_name`, { channelId, normalizedName });
      continue;
    }

    const prefixes = buildPrefixes(normalizedName);
    if (!prefixes.length) {
      readyToMark.push(channelId);
      console.log(`${INDEXER_LOG_CONTEXT} artist_skipped_no_prefixes`, { channelId, normalizedName });
      continue;
    }

    const rows = buildRows(prefixes, channelId, normalizedName, new Date().toISOString());
    const insertResult = await insertSuggestEntries(client, rows);

    if (insertResult.success) {
      readyToMark.push(channelId);
    }

    console.log(`${INDEXER_LOG_CONTEXT} artist_done`, {
      channelId,
      normalizedName,
      totalPrefixes: prefixes.length,
      insertedCount: insertResult.inserted,
    });
  }

  const markResult = await markArtistsProcessed(client, readyToMark);

  console.log(`${INDEXER_LOG_CONTEXT} tick_complete`, {
    processed_attempted: processedAttempted,
    inserted_new: markResult.inserted,
    skipped_existing: markResult.skipped,
  });

  return { processed: processedAttempted };
}

export async function runArtistSuggestTick(): Promise<void> {
  await runArtistSuggestBatch();
}
