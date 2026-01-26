import type { SupabaseClient } from '@supabase/supabase-js';

import { getSupabaseAdmin } from '../services/supabaseClient';
import {
  musicSearch,
  type MusicSearchAlbum,
  type MusicSearchArtist,
  type MusicSearchPlaylist,
  type MusicSearchTrack,
} from '../services/youtubeMusicClient';

const JOB_LOG_CONTEXT = '[ArtistSuggestBatch]';
const INDEXER_LOG_CONTEXT = '[suggest-indexer]';
export const ARTIST_SUGGEST_CRON = '* * * * *';

const BATCH_LIMIT = 1; // exactly one artist per tick
const MIN_PREFIX_LENGTH = 2;
const MAX_PREFIX_LENGTH = 12;
const SOURCE_TAG = 'artist_indexer';

type SuggestEntityType = 'artist' | 'album' | 'playlist' | 'track';

type ArtistRow = {
  artist_key: string;
  artist: string | null;
  display_name: string | null;
  normalized_name: string | null;
  youtube_channel_id: string | null;
};

type SuggestEntryInsert = {
  query: string;
  normalized_query: string;
  entity_type: SuggestEntityType;
  external_id: string;
  results: Record<string, unknown>;
  meta: Record<string, unknown>;
  source: string;
  artist_channel_id: string | null;
};

type InsertedEntityFlags = {
  artist: boolean;
  track: boolean;
  album: boolean;
  playlist: boolean;
};

const VALID_ID_PATTERNS: Record<SuggestEntityType, RegExp> = {
  artist: /^UC[a-zA-Z0-9_-]+$/,
  album: /^MPREb[a-zA-Z0-9_-]+$/,
  playlist: /^(PL|VLPL|RDCLAK|OLAK5uy)[a-zA-Z0-9_-]+$/,
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

function buildPrefixesFromDisplayName(row: ArtistRow): string[] {
  const base = normalizeQuery(row.display_name);
  if (!base) return [];

  const prefixes: string[] = [];
  const maxLen = Math.min(base.length, MAX_PREFIX_LENGTH);
  for (let i = MIN_PREFIX_LENGTH; i <= maxLen; i++) {
    prefixes.push(base.slice(0, i));
  }
  return prefixes;
}

async function fetchArtistCandidate(client: SupabaseClient): Promise<ArtistRow | null> {
  const { data, error } = await client.rpc('fetch_artist_suggest_candidates', { limit_count: BATCH_LIMIT });

  if (error) {
    console.error(`${JOB_LOG_CONTEXT} candidates_select_failed`, { message: error.message });
    return null;
  }

  const rows = (data ?? []) as ArtistRow[];
  if (!rows.length) return null;
  return rows[0];
}

function isValidExternalId(type: SuggestEntityType, id: string): boolean {
  const normalized = normalizeValue(id);
  if (!normalized) return false;
  return VALID_ID_PATTERNS[type].test(normalized);
}

function buildResultPayload(
  entityType: SuggestEntityType,
  title: string,
  endpointType: 'browse' | 'watch',
  endpointPayload: string,
  imageUrl?: string | null,
  subtitle?: string | null,
): Record<string, unknown> {
  const payload: Record<string, unknown> = { type: entityType, title, endpointType, endpointPayload };
  if (subtitle) payload.subtitle = subtitle;
  if (imageUrl) payload.imageUrl = imageUrl;
  return payload;
}

function buildArtistRow(prefix: string, artist?: MusicSearchArtist): SuggestEntryInsert | null {
  if (!artist) return null;
  const channelId = normalizeValue(artist.id);
  if (!isValidExternalId('artist', channelId)) return null;

  const title = normalizeValue(artist.name) || channelId;
  const results = buildResultPayload('artist', title, 'browse', channelId, artist.imageUrl ?? null, null);

  return {
    query: prefix,
    normalized_query: prefix,
    entity_type: 'artist',
    external_id: channelId,
    results,
    meta: { entity_type: 'artist', external_id: channelId },
    source: SOURCE_TAG,
    artist_channel_id: channelId,
  };
}

function buildTrackRow(prefix: string, track?: MusicSearchTrack): SuggestEntryInsert | null {
  if (!track) return null;
  const videoId = normalizeValue(track.youtubeId || track.id);
  if (!isValidExternalId('track', videoId)) return null;

  const title = normalizeValue(track.title) || videoId;
  const subtitle = normalizeValue(track.artist);
  const results = buildResultPayload('track', title, 'watch', videoId, track.imageUrl ?? null, subtitle || null);

  return {
    query: prefix,
    normalized_query: prefix,
    entity_type: 'track',
    external_id: videoId,
    results,
    meta: { entity_type: 'track', external_id: videoId },
    source: SOURCE_TAG,
    artist_channel_id: null,
  };
}

function buildAlbumRow(prefix: string, album?: MusicSearchAlbum): SuggestEntryInsert | null {
  if (!album) return null;
  const albumId = normalizeValue(album.id);
  if (!isValidExternalId('album', albumId)) return null;

  const title = normalizeValue(album.title) || albumId;
  const subtitle = normalizeValue(album.channelTitle) || normalizeValue(album.channelId);
  const results = buildResultPayload('album', title, 'browse', albumId, album.imageUrl ?? null, subtitle || null);

  return {
    query: prefix,
    normalized_query: prefix,
    entity_type: 'album',
    external_id: albumId,
    results,
    meta: { entity_type: 'album', external_id: albumId },
    source: SOURCE_TAG,
    artist_channel_id: null,
  };
}

function buildPlaylistRow(prefix: string, playlist?: MusicSearchPlaylist): SuggestEntryInsert | null {
  if (!playlist) return null;
  const playlistId = normalizeValue(playlist.id);
  if (!isValidExternalId('playlist', playlistId)) return null;

  const title = normalizeValue(playlist.title) || playlistId;
  const subtitle = normalizeValue(playlist.channelTitle) || normalizeValue(playlist.channelId);
  const results = buildResultPayload('playlist', title, 'browse', playlistId, playlist.imageUrl ?? null, subtitle || null);

  return {
    query: prefix,
    normalized_query: prefix,
    entity_type: 'playlist',
    external_id: playlistId,
    results,
    meta: { entity_type: 'playlist', external_id: playlistId },
    source: SOURCE_TAG,
    artist_channel_id: null,
  };
}

async function buildRowsFromSearch(prefix: string): Promise<{ rows: SuggestEntryInsert[]; flags: InsertedEntityFlags }> {
  const rows: SuggestEntryInsert[] = [];
  const flags: InsertedEntityFlags = { artist: false, track: false, album: false, playlist: false };

  const searchResults = await musicSearch(prefix);

  const artistRow = buildArtistRow(prefix, searchResults.artists?.[0]);
  if (artistRow) {
    rows.push(artistRow);
    flags.artist = true;
  }

  const trackRow = buildTrackRow(prefix, searchResults.tracks?.[0]);
  if (trackRow) {
    rows.push(trackRow);
    flags.track = true;
  }

  const albumRow = buildAlbumRow(prefix, searchResults.albums?.[0]);
  if (albumRow) {
    rows.push(albumRow);
    flags.album = true;
  }

  const playlistRow = buildPlaylistRow(prefix, searchResults.playlists?.[0]);
  if (playlistRow) {
    rows.push(playlistRow);
    flags.playlist = true;
  }

  return { rows, flags };
}

async function countExisting(
  client: SupabaseClient,
  prefix: string,
  rows: SuggestEntryInsert[],
): Promise<number> {
  if (!rows.length) return 0;

  const externalIds = Array.from(new Set(rows.map((r) => r.external_id)));
  const entityTypes = Array.from(new Set(rows.map((r) => r.entity_type)));

  const { data, error } = await client
    .from('suggest_entries')
    .select('external_id', { head: false })
    .eq('normalized_query', prefix)
    .eq('source', SOURCE_TAG)
    .in('entity_type', entityTypes)
    .in('external_id', externalIds);

  if (error) {
    console.error(`${INDEXER_LOG_CONTEXT} find_existing_failed`, { prefix, message: error.message });
    return 0;
  }

  return data?.length ?? 0;
}

async function insertSuggestEntries(
  client: SupabaseClient,
  prefix: string,
  rows: SuggestEntryInsert[],
): Promise<{ insertedNew: number; skippedExisting: number; attempted: number; success: boolean }> {
  const attempted = rows.length;
  if (!attempted) return { insertedNew: 0, skippedExisting: 0, attempted: 0, success: true };

  const existingCount = await countExisting(client, prefix, rows);

  const { error } = await client
    .from('suggest_entries')
    .upsert(rows, {
      onConflict: 'source,normalized_query,entity_type,external_id',
      ignoreDuplicates: true,
      returning: 'minimal',
    });

  if (error) {
    const message = error.message;
    const missingUnique = message?.toLowerCase().includes('no unique or exclusion constraint matching the on conflict specification');
    console.error(`${INDEXER_LOG_CONTEXT} entries_insert_failed`, { prefix, message });
    if (missingUnique) {
      console.error(`${INDEXER_LOG_CONTEXT} missing_unique_constraint`, {
        required: 'UNIQUE(source, normalized_query, entity_type, external_id)',
      });
    }
    return { insertedNew: 0, skippedExisting: 0, attempted, success: false };
  }

  const insertedNew = Math.max(attempted - existingCount, 0);
  return { insertedNew, skippedExisting: existingCount, attempted, success: true };
}

async function markArtistProcessed(
  client: SupabaseClient,
  channelId: string,
): Promise<{ insertedNew: number; skippedExisting: number }> {
  const id = normalizeValue(channelId);
  if (!id) return { insertedNew: 0, skippedExisting: 0 };

  const { count } = await client
    .from('suggest_queries')
    .select('artist_channel_id', { head: true, count: 'exact' })
    .eq('artist_channel_id', id);

  const preExisting = (count ?? 0) > 0;

  const { error } = await client
    .from('suggest_queries')
    .upsert({ artist_channel_id: id }, { onConflict: 'artist_channel_id', ignoreDuplicates: true, returning: 'minimal' });

  if (error) {
    console.error(`${INDEXER_LOG_CONTEXT} mark_processed_failed`, { message: error.message });
    return { insertedNew: 0, skippedExisting: 0 };
  }

  return { insertedNew: preExisting ? 0 : 1, skippedExisting: preExisting ? 1 : 0 };
}

export async function runArtistSuggestBatch(): Promise<{ processed: number }> {
  const client = getSupabaseAdmin();

  let processedAttempted = 0;
  let prefixesGenerated = 0;
  let insertedNewTotal = 0;
  let skippedExistingTotal = 0;

  const candidate = await fetchArtistCandidate(client);
  if (!candidate) {
    console.log(`${INDEXER_LOG_CONTEXT} tick_complete`, {
      processed_attempted: processedAttempted,
      prefixes_generated: prefixesGenerated,
      inserted_new_total: insertedNewTotal,
      skipped_existing_total: skippedExistingTotal,
      reason: 'no_remaining_candidates',
    });
    return { processed: 0 };
  }

  const channelId = normalizeValue(candidate.youtube_channel_id);
  if (!channelId) {
    console.log(`${INDEXER_LOG_CONTEXT} artist_skipped_missing_channel`, { artist_key: candidate.artist_key });
    return { processed: 0 };
  }

  processedAttempted = 1;

  const prefixes = buildPrefixesFromDisplayName(candidate);
  if (!prefixes.length) {
    const markResult = await markArtistProcessed(client, channelId);
    console.log(`${INDEXER_LOG_CONTEXT} artist_skipped_short_name`, {
      channelId,
      inserted_new: markResult.insertedNew,
      skipped_existing: markResult.skippedExisting,
    });
    return { processed: processedAttempted };
  }

  prefixesGenerated = prefixes.length;

  for (const prefix of prefixes) {
    const { rows, flags } = await buildRowsFromSearch(prefix);

    const { insertedNew, skippedExisting, attempted, success } = await insertSuggestEntries(client, prefix, rows);
    if (success) {
      insertedNewTotal += insertedNew;
      skippedExistingTotal += skippedExisting;
    }

    console.log(`${INDEXER_LOG_CONTEXT} prefix_processed`, {
      prefix,
      inserted_entities: flags,
      inserted_new_total: insertedNewTotal,
      skipped_existing_total: skippedExistingTotal,
      attempted,
      success,
    });
  }

  const markResult = await markArtistProcessed(client, channelId);

  console.log(`${INDEXER_LOG_CONTEXT} tick_complete`, {
    processed_attempted: processedAttempted,
    prefixes_generated: prefixesGenerated,
    inserted_new_total: insertedNewTotal,
    skipped_existing_total: skippedExistingTotal,
    mark_inserted: markResult.insertedNew,
    mark_skipped_existing: markResult.skippedExisting,
  });

  return { processed: processedAttempted };
}

export async function runArtistSuggestTick(): Promise<void> {
  await runArtistSuggestBatch();
}
