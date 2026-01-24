import { getSupabaseAdmin } from './supabaseClient';

type ArtistRow = {
  artist_key: string;
  artist: string | null;
  display_name: string | null;
  normalized_name: string | null;
  created_at: string | null;
  updated_at?: string | null;
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
  entity_type: 'artist' | 'album' | 'playlist' | 'track';
};

type SuggestQueryRow = {
  artist_channel_id: string;
};

const SOURCE_TAG = 'artist_indexer';
const MIN_PREFIX_LENGTH = 2;
const MAX_PREFIX_LENGTH = 120;
const ENTITY_TYPES = ['artist', 'album', 'playlist', 'track'] as const;
const BATCH_LIMIT = 50;
const CANDIDATE_MULTIPLIER = 3;

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

async function fetchCandidateArtists(limit: number): Promise<ArtistRow[]> {
  const client = getSupabaseAdmin();
  const candidateLimit = limit * CANDIDATE_MULTIPLIER;

  console.log('[suggest-indexer] artists_fetch_start', {
    candidateLimit,
    sort: ['updated_at asc', 'created_at asc'],
  });

  const { data, error } = await client
    .from('artists')
    .select('artist_key, artist, display_name, normalized_name, youtube_channel_id, updated_at, created_at')
    .not('youtube_channel_id', 'is', null)
    .neq('youtube_channel_id', '')
    .order('updated_at', { ascending: true, nullsFirst: false })
    .order('created_at', { ascending: true })
    .limit(candidateLimit);

  if (error) {
    console.error('[suggest-indexer] artist_fetch_failed', error.message);
    return [];
  }

  return (data || []) as ArtistRow[];
}

async function fetchProcessedChannels(channelIds: string[]): Promise<Set<string>> {
  if (!channelIds.length) return new Set();

  const client = getSupabaseAdmin();
  console.log('[suggest-indexer] processed_channels_fetch', { count: channelIds.length });

  const { data, error } = await client
    .from('suggest_queries')
    .select('artist_channel_id')
    .in('artist_channel_id', channelIds);

  if (error) {
    console.error('[suggest-indexer] processed_fetch_failed', error.message);
    return new Set();
  }

  const processedRows = (data || []) as SuggestQueryRow[];
  return new Set(processedRows.map((row) => row.artist_channel_id).filter(Boolean));
}

async function fetchUnprocessedArtists(limit: number): Promise<ArtistRow[]> {
  const candidates = await fetchCandidateArtists(limit);
  if (!candidates.length) return [];

  const channelIds = candidates
    .map((row) => row.youtube_channel_id?.trim())
    .filter((id): id is string => Boolean(id));

  const processedSet = await fetchProcessedChannels(channelIds);
  const unprocessed = candidates.filter((row) => {
    const channelId = row.youtube_channel_id?.trim() || '';
    return channelId && !processedSet.has(channelId);
  });

  console.log('[suggest-indexer] unprocessed_ready', {
    candidates: candidates.length,
    processed: processedSet.size,
    selected: unprocessed.length,
    limit,
  });

  return unprocessed.slice(0, limit);
}

async function insertSuggestEntries(
  rows: SuggestEntryRow[]
): Promise<{ success: boolean; inserted: number }> {
  if (!rows.length) return { success: false, inserted: 0 };

  const client = getSupabaseAdmin();

  const { data, error } = await client
    .from('suggest_entries')
    .upsert(rows, {
      onConflict: 'source,normalized_query,artist_channel_id,entity_type',
    })
    .select('id');

  if (error) {
    console.error('[suggest-indexer] entries_upsert_failed', error.message);
    return { success: false, inserted: 0 };
  }

  return { success: true, inserted: data?.length ?? 0 };
}

async function markArtistProcessed(channelId: string): Promise<boolean> {
  const client = getSupabaseAdmin();
  const payload = { artist_channel_id: channelId, created_at: new Date().toISOString() };

  const { error } = await client.from('suggest_queries').upsert(payload, {
    onConflict: 'artist_channel_id',
  });

  if (error) {
    console.error('[suggest-indexer] mark_processed_failed', error.message);
    return false;
  }

  return true;
}

export async function runSuggestIndexerTick(): Promise<{ processed: number }> {
  let processed = 0;

  const artists = await fetchUnprocessedArtists(BATCH_LIMIT);
  if (!artists.length) {
    console.log('[suggest-indexer] tick_complete', { processed });
    return { processed };
  }

  for (const artist of artists) {
    const channelId = (artist.youtube_channel_id || '').trim();
    if (!channelId) continue;

    const normalizedName = pickNormalizedName(artist);
    if (!normalizedName || normalizedName.length < MIN_PREFIX_LENGTH) {
      await markArtistProcessed(channelId);
      processed += 1;
      continue;
    }

    const prefixes = buildPrefixes(normalizedName);
    if (!prefixes.length) {
      await markArtistProcessed(channelId);
      processed += 1;
      continue;
    }

    const seenAt = new Date().toISOString();
    const rows = buildRows(prefixes, channelId, normalizedName, seenAt);

    const insertResult = await insertSuggestEntries(rows);
    const marked = await markArtistProcessed(channelId);

    if (insertResult.success && marked) {
      processed += 1;
      console.log('[suggest-indexer] artist_done', {
        channelId,
        normalizedName,
        totalPrefixes: prefixes.length,
        insertedCount: insertResult.inserted,
      });
    }
  }

  console.log('[suggest-indexer] tick_complete', { processed });
  return { processed };
}

export const DAILY_ARTIST_SUGGEST_CRON = '*/5 7-20 * * *';

export async function runArtistSuggestTick(): Promise<void> {
  await runSuggestIndexerTick();
}
