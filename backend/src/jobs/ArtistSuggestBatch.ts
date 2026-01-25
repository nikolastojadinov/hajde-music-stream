import type { SupabaseClient } from '@supabase/supabase-js';

import { CONSENT_COOKIES, fetchInnertubeConfig } from '../services/youtubeInnertubeConfig';
import { getSupabaseAdmin } from '../services/supabaseClient';

const JOB_LOG_CONTEXT = '[ArtistSuggestBatch]';
const INDEXER_LOG_CONTEXT = '[suggest-indexer]';
export const ARTIST_SUGGEST_CRON = '* * * * *';

const BATCH_LIMIT = 1; // exactly one artist per tick
const MIN_PREFIX_LENGTH = 2;
const MAX_PREFIX_LENGTH = 12;
const SOURCE_TAG = 'artist_indexer';

type SuggestEntityType = 'artist' | 'album' | 'playlist' | 'track';
type SuggestEndpointType = 'browse' | 'watch' | 'watchPlaylist';

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
};

type PrefixEntity = {
  type: SuggestEntityType;
  externalId: string;
  title: string;
  endpointType: SuggestEndpointType;
  endpointPayload: string;
};

type PrefixEntityMap = Partial<Record<SuggestEntityType, PrefixEntity>>;

type InnertubeConfig = {
  apiKey: string;
  clientName: string;
  clientVersion: string;
  visitorData: string;
  apiBase: string;
};

const USER_AGENT =
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

const SEARCH_PARAMS: Record<SuggestEntityType, string> = {
  artist: 'EgWKAQIIAWoKEAkQBRAKEAMQBA%3D%3D',
  album: 'EgWKAQIYAWoKEAkQBRAKEAMQBA%3D%3D',
  playlist: 'EgWKAQIQAWoKEAkQBRAKEAMQBA%3D%3D',
  track: 'EgWKAQIoAWoKEAkQBRAKEAMQBA%3D%3D',
};

const VALID_ID_PATTERNS: Record<SuggestEntityType, RegExp> = {
  artist: /^UC[a-zA-Z0-9_-]+$/,
  album: /^MPREb[a-zA-Z0-9_-]+$/,
  playlist: /^(PL|VLPL|RDCLAK|OLAK5uy)[a-zA-Z0-9_-]+$/,
  track: /^[a-zA-Z0-9_-]{11}$/,
};

const ENTITY_TYPES: SuggestEntityType[] = ['artist', 'album', 'playlist', 'track'];

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
  return VALID_ID_PATTERNS[type].test(id);
}

function resolveApiBase(config: InnertubeConfig): string {
  return config.apiBase.endsWith('/') ? config.apiBase : `${config.apiBase}/`;
}

async function callYoutubei(config: InnertubeConfig, path: string, payload: Record<string, unknown>): Promise<any> {
  const base = resolveApiBase(config);
  const url = `${base}${path}?prettyPrint=false&key=${encodeURIComponent(config.apiKey)}`;

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      'Accept-Language': 'en-US,en;q=0.9',
      'User-Agent': USER_AGENT,
      Origin: 'https://music.youtube.com',
      Referer: 'https://music.youtube.com/search',
      Cookie: CONSENT_COOKIES,
      'X-Goog-Visitor-Id': config.visitorData,
      'X-YouTube-Client-Name': config.clientName,
      'X-YouTube-Client-Version': config.clientVersion,
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    throw new Error(`Innertube request failed: ${response.status}`);
  }

  return response.json();
}

function buildSearchBody(config: InnertubeConfig, query: string, params: string): Record<string, unknown> {
  return {
    context: {
      client: {
        clientName: config.clientName,
        clientVersion: config.clientVersion,
        hl: 'en',
        gl: 'US',
        platform: 'DESKTOP',
        visitorData: config.visitorData,
        userAgent: USER_AGENT,
        utcOffsetMinutes: 0,
      },
      user: { enableSafetyMode: false },
      request: { internalExperimentFlags: [], sessionIndex: 0 },
    },
    query,
    params,
  };
}

function pickRunsText(runs: any): string {
  if (!Array.isArray(runs) || runs.length === 0) return '';
  return runs
    .map((r) => normalizeValue(r?.text))
    .join('')
    .trim();
}

function pickText(node: any): string {
  const runs = node?.runs;
  if (Array.isArray(runs) && runs.length > 0) return pickRunsText(runs);
  const simple = node?.simpleText;
  return normalizeValue(simple);
}

function extractNavigation(renderer: any): { browseId: string; videoId: string } {
  const navigation =
    renderer?.navigationEndpoint ||
    renderer?.playNavigationEndpoint ||
    renderer?.overlay?.musicItemThumbnailOverlayRenderer?.content?.musicPlayButtonRenderer?.playNavigationEndpoint ||
    renderer?.menu?.navigationItemRenderer?.navigationEndpoint;

  const browseId = normalizeValue(
    navigation?.browseEndpoint?.browseId ||
      renderer?.browseEndpoint?.browseId ||
      navigation?.watchEndpoint?.playlistId ||
      renderer?.playlistId,
  );
  const videoId = normalizeValue(navigation?.watchEndpoint?.videoId || renderer?.watchEndpoint?.videoId || renderer?.videoId);
  return { browseId, videoId };
}

function findRendererMatchingType(json: any, type: SuggestEntityType): any | null {
  const tabs =
    json?.contents?.tabbedSearchResultsRenderer?.tabs ||
    json?.tabbedSearchResultsRenderer?.tabs ||
    [];

  for (const tab of tabs) {
    const sections = tab?.tabRenderer?.content?.sectionListRenderer?.contents || [];

    for (const section of sections) {
      const shelf = section?.musicShelfRenderer;
      const contents = shelf?.contents || [];

      for (const item of contents) {
        const renderer = item?.musicResponsiveListItemRenderer;
        if (!renderer) continue;

        const { browseId, videoId } = extractNavigation(renderer);
        const candidateId = type === 'track' ? videoId : browseId;

        if (candidateId && isValidExternalId(type, candidateId)) {
          return renderer;
        }
      }
    }
  }

  return null;
}

function parseTopEntity(prefix: string, type: SuggestEntityType, json: any): PrefixEntity | null {
  const renderer = findRendererMatchingType(json, type);
  if (!renderer) return null;

  const title =
    pickRunsText(renderer?.flexColumns?.[0]?.musicResponsiveListItemFlexColumnRenderer?.text?.runs) ||
    pickText(renderer?.title);

  const { browseId, videoId } = extractNavigation(renderer);

  if (type === 'track') {
    const video = normalizeValue(videoId);
    if (video && isValidExternalId('track', video)) {
      return {
        type: 'track',
        externalId: video,
        title: title || video,
        endpointType: 'watch',
        endpointPayload: video,
      };
    }
    return null;
  }

  const browse = normalizeValue(browseId);
  if (!browse || !isValidExternalId(type, browse)) return null;

  const endpointType: SuggestEndpointType = type === 'playlist' ? 'watchPlaylist' : 'browse';

  return {
    type,
    externalId: browse,
    title: title || browse,
    endpointType,
    endpointPayload: browse,
  };
}

async function searchTop(prefix: string, type: SuggestEntityType, config: InnertubeConfig): Promise<PrefixEntity | null> {
  const params = SEARCH_PARAMS[type];
  const payload = buildSearchBody(config, prefix, params);

  try {
    const json = await callYoutubei(config, 'search', payload);
    const entity = parseTopEntity(prefix, type, json);

    if (!entity) {
      const renderer = findRendererMatchingType(json, type);
      const title =
        pickRunsText(renderer?.flexColumns?.[0]?.musicResponsiveListItemFlexColumnRenderer?.text?.runs) ||
        pickText(renderer?.title);
      const { browseId, videoId } = extractNavigation(renderer ?? {});

      console.log(`${INDEXER_LOG_CONTEXT} search_no_entity`, {
        prefix,
        entity_type: type,
        title,
        browse_id: browseId,
        video_id: videoId,
        has_renderer: Boolean(renderer),
      });
    }

    return entity;
  } catch (err) {
    console.error(`${INDEXER_LOG_CONTEXT} search_failed`, {
      prefix,
      entity_type: type,
      message: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}

async function fetchPrefixEntities(prefix: string, config: InnertubeConfig): Promise<PrefixEntityMap> {
  const entities: PrefixEntityMap = {};
  for (const type of ENTITY_TYPES) {
    const entity = await searchTop(prefix, type, config);
    if (entity) {
      entities[type] = entity;
    }
  }
  return entities;
}

function buildRows(prefix: string, entities: PrefixEntityMap): SuggestEntryInsert[] {
  const rows: SuggestEntryInsert[] = [];
  for (const type of ENTITY_TYPES) {
    const entity = entities[type];
    if (!entity) continue;

    rows.push({
      query: prefix,
      normalized_query: prefix,
      entity_type: type,
      external_id: entity.externalId,
      results: {
        type: entity.type,
        title: entity.title,
        endpointType: entity.endpointType,
        endpointPayload: entity.endpointPayload,
      },
      meta: { entity_type: entity.type, external_id: entity.externalId },
      source: SOURCE_TAG,
    });
  }
  return rows;
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
): Promise<{ insertedNew: number; skippedExisting: number; attempted: number; success: boolean }>
{
  const attempted = rows.length;
  if (!attempted) return { insertedNew: 0, skippedExisting: 0, attempted: 0, success: true };

  const existingCount = await countExisting(client, prefix, rows);

  const { error } = await client
    .from('suggest_entries')
    .upsert(rows, {
      onConflict: 'normalized_query,entity_type,external_id',
      ignoreDuplicates: true,
      returning: 'minimal',
    });

  if (error) {
    console.error(`${INDEXER_LOG_CONTEXT} entries_insert_failed`, { prefix, message: error.message });
    return { insertedNew: 0, skippedExisting: 0, attempted, success: false };
  }

  const insertedNew = Math.max(attempted - existingCount, 0);
  return { insertedNew, skippedExisting: existingCount, attempted, success: true };
}

async function markArtistProcessed(
  client: SupabaseClient,
  channelId: string,
): Promise<{ insertedNew: number; skippedExisting: number }>
{
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
  const config = (await fetchInnertubeConfig()) as InnertubeConfig;

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
    const entities = await fetchPrefixEntities(prefix, config);
    const rows = buildRows(prefix, entities);

    const { insertedNew, skippedExisting, attempted, success } = await insertSuggestEntries(client, prefix, rows);
    if (success) {
      insertedNewTotal += insertedNew;
      skippedExistingTotal += skippedExisting;
    }

    const insertedEntities = {
      artist: Boolean(rows.find((r) => r.entity_type === 'artist')),
      album: Boolean(rows.find((r) => r.entity_type === 'album')),
      playlist: Boolean(rows.find((r) => r.entity_type === 'playlist')),
      track: Boolean(rows.find((r) => r.entity_type === 'track')),
    };

    console.log(`${INDEXER_LOG_CONTEXT} prefix_processed`, {
      prefix,
      inserted_entities: insertedEntities,
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
import type { SupabaseClient } from '@supabase/supabase-js';

import { CONSENT_COOKIES, fetchInnertubeConfig } from '../services/youtubeInnertubeConfig';
import { getSupabaseAdmin } from '../services/supabaseClient';

const JOB_LOG_CONTEXT = '[ArtistSuggestBatch]';
const INDEXER_LOG_CONTEXT = '[suggest-indexer]';
export const ARTIST_SUGGEST_CRON = '* * * * *';

const BATCH_LIMIT = 1; // exactly one artist per tick
const MIN_PREFIX_LENGTH = 2;
const MAX_PREFIX_LENGTH = 12;
const SOURCE_TAG = 'artist_indexer';

const SEARCH_PARAMS: Record<SuggestEntityType, string> = {
  artist: 'EgWKAQIIAWoKEAkQBRAKEAMQBA%3D%3D',
  album: 'EgWKAQIYAWoKEAkQBRAKEAMQBA%3D%3D',
  track: 'EgWKAQIoAWoKEAkQBRAKEAMQBA%3D%3D',
  playlist: 'EgWKAQIQAWoKEAkQBRAKEAMQBA%3D%3D',
};

const VALID_ID_PATTERNS: Record<SuggestEntityType, RegExp> = {
  artist: /^UC[a-zA-Z0-9_-]+$/,
  album: /^MPREb[a-zA-Z0-9_-]+$/,
  playlist: /^(PL|VLPL|RDCLAK|OLAK5uy)[a-zA-Z0-9_-]+$/,
  track: /^[a-zA-Z0-9_-]{11}$/,
};

type SuggestEntityType = 'artist' | 'album' | 'track' | 'playlist';
type SuggestEndpointType = 'browse' | 'watch' | 'watchPlaylist';

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
};

type PrefixEntity = {
  type: SuggestEntityType;
  externalId: string;
  title: string;
  endpointType: SuggestEndpointType;
  endpointPayload: string;
};

type PrefixEntityMap = Partial<Record<SuggestEntityType, PrefixEntity>>;

type InnertubeConfig = {
  apiKey: string;
  clientName: string;
  clientVersion: string;
  visitorData: string;
  apiBase: string;
};

const USER_AGENT =
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

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
  return VALID_ID_PATTERNS[type].test(id);
}

function resolveApiBase(config: InnertubeConfig): string {
  return config.apiBase.endsWith('/') ? config.apiBase : `${config.apiBase}/`;
}

async function callYoutubei(config: InnertubeConfig, path: string, payload: Record<string, unknown>): Promise<any> {
  const base = resolveApiBase(config);
  const url = `${base}${path}?prettyPrint=false&key=${encodeURIComponent(config.apiKey)}`;

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      'Accept-Language': 'en-US,en;q=0.9',
      'User-Agent': USER_AGENT,
      Origin: 'https://music.youtube.com',
      Referer: 'https://music.youtube.com/search',
      Cookie: CONSENT_COOKIES,
      'X-Goog-Visitor-Id': config.visitorData,
      'X-YouTube-Client-Name': config.clientName,
      'X-YouTube-Client-Version': config.clientVersion,
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    throw new Error(`Innertube request failed: ${response.status}`);
  }

  return response.json();
}

function buildSearchBody(config: InnertubeConfig, query: string, params: string): Record<string, unknown> {
  return {
    context: {
      client: {
        clientName: config.clientName,
        clientVersion: config.clientVersion,
        hl: 'en',
        gl: 'US',
        platform: 'DESKTOP',
        visitorData: config.visitorData,
        userAgent: USER_AGENT,
        utcOffsetMinutes: 0,
      },
      user: { enableSafetyMode: false },
      request: { internalExperimentFlags: [], sessionIndex: 0 },
    },
    query,
    params,
  };
}

function pickRunsText(runs: any): string {
  if (!Array.isArray(runs) || runs.length === 0) return '';
  return runs
    .map((r) => normalizeValue(r?.text))
    .join('')
    .trim();
}

function pickText(node: any): string {
  const runs = node?.runs;
  if (Array.isArray(runs) && runs.length > 0) return pickRunsText(runs);
  const simple = node?.simpleText;
  return normalizeValue(simple);
}

function extractNavigation(renderer: any): { browseId: string; videoId: string } {
  const navigation =
    renderer?.navigationEndpoint ||
    renderer?.playNavigationEndpoint ||
    renderer?.overlay?.musicItemThumbnailOverlayRenderer?.content?.musicPlayButtonRenderer?.playNavigationEndpoint ||
    renderer?.menu?.navigationItemRenderer?.navigationEndpoint;

  const browseId = normalizeValue(
    navigation?.browseEndpoint?.browseId ||
      renderer?.browseEndpoint?.browseId ||
      navigation?.watchEndpoint?.playlistId ||
      renderer?.playlistId,
  );
  const videoId = normalizeValue(navigation?.watchEndpoint?.videoId || renderer?.watchEndpoint?.videoId || renderer?.videoId);
  return { browseId, videoId };
}

function findRendererForType(json: any, type: SuggestEntityType): any | null {
  const tabs =
    json?.contents?.tabbedSearchResultsRenderer?.tabs ||
    json?.tabbedSearchResultsRenderer?.tabs ||
    [];

  for (const tab of tabs) {
    const sections = tab?.tabRenderer?.content?.sectionListRenderer?.contents || [];

    for (const section of sections) {
      const shelf = section?.musicShelfRenderer;
      const contents = shelf?.contents || [];

      for (const item of contents) {
        const renderer = item?.musicResponsiveListItemRenderer;
        if (!renderer) continue;

        const { browseId, videoId } = extractNavigation(renderer);
        const candidateId = type === 'track' ? videoId : browseId;

        if (candidateId && isValidExternalId(type, candidateId)) {
          return renderer;
        }
      }
    }
  }

  return null;
}

function parseTopEntity(prefix: string, type: SuggestEntityType, json: any): PrefixEntity | null {
  const renderer = findRendererForType(json, type);
  if (!renderer) return null;

  const title =
    pickRunsText(renderer?.flexColumns?.[0]?.musicResponsiveListItemFlexColumnRenderer?.text?.runs) || pickText(renderer?.title);

  const { browseId, videoId } = extractNavigation(renderer);

  if (type === 'track') {
    const video = normalizeValue(videoId);
    if (video && isValidExternalId('track', video)) {
      return {
        type: 'track',
        externalId: video,
        title: title || video,
        endpointType: 'watch',
        endpointPayload: video,
      };
    }
    return null;
  }

  const browse = normalizeValue(browseId);
  if (!browse || !title) return null;
  if (!isValidExternalId(type, browse)) return null;

  const endpointType: SuggestEndpointType = type === 'playlist' ? 'watchPlaylist' : 'browse';

  return {
    type,
    externalId: browse,
    title,
    endpointType,
    endpointPayload: browse,
  };
}

async function searchTop(prefix: string, type: SuggestEntityType, config: InnertubeConfig): Promise<PrefixEntity | null> {
  const params = SEARCH_PARAMS[type];
  const payload = buildSearchBody(config, prefix, params);

  try {
    const json = await callYoutubei(config, 'search', payload);
    const entity = parseTopEntity(prefix, type, json);

    if (!entity && (type === 'playlist' || type === 'track')) {
      const renderer = findRendererForType(json, type);
      const title =
        pickRunsText(renderer?.flexColumns?.[0]?.musicResponsiveListItemFlexColumnRenderer?.text?.runs) ||
        pickText(renderer?.title);
      const { browseId, videoId } = extractNavigation(renderer ?? {});

      console.log(`${INDEXER_LOG_CONTEXT} search_no_entity`, {
        prefix,
        entity_type: type,
        title,
        browse_id: browseId,
        video_id: videoId,
        has_renderer: Boolean(renderer),
      });
    }

    return entity;
  } catch (err) {
    console.error(`${INDEXER_LOG_CONTEXT} search_failed`, {
      prefix,
      entity_type: type,
      message: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}

async function fetchPrefixEntities(prefix: string, config: InnertubeConfig): Promise<PrefixEntityMap> {
  const entities: PrefixEntityMap = {};
  for (const type of ['artist', 'album', 'playlist', 'track'] as const) {
    const entity = await searchTop(prefix, type, config);
    if (entity) {
      entities[type] = entity;
    }
  }
  return entities;
}

function buildRows(prefix: string, entities: PrefixEntityMap): SuggestEntryInsert[] {
  const rows: SuggestEntryInsert[] = [];
  for (const type of ['artist', 'album', 'playlist', 'track'] as const) {
    const entity = entities[type];
    if (!entity) continue;

    rows.push({
      query: prefix,
      normalized_query: prefix,
      entity_type: type,
      external_id: entity.externalId,
      results: {
        type: entity.type,
        title: entity.title,
        endpointType: entity.endpointType,
        endpointPayload: entity.endpointPayload,
      },
      meta: { entity_type: entity.type, external_id: entity.externalId },
      source: SOURCE_TAG,
    });
  }
  return rows;
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
): Promise<{ insertedNew: number; skippedExisting: number; attempted: number; success: boolean }>
{
  const attempted = rows.length;
  if (!attempted) return { insertedNew: 0, skippedExisting: 0, attempted: 0, success: true };

  const existingCount = await countExisting(client, prefix, rows);

  const { error } = await client
    .from('suggest_entries')
    .upsert(rows, {
      onConflict: 'normalized_query,entity_type,external_id',
      ignoreDuplicates: true,
      returning: 'minimal',
    });

  if (error) {
    console.error(`${INDEXER_LOG_CONTEXT} entries_insert_failed`, { prefix, message: error.message });
    return { insertedNew: 0, skippedExisting: 0, attempted, success: false };
  }

  const insertedNew = Math.max(attempted - existingCount, 0);
  return { insertedNew, skippedExisting: existingCount, attempted, success: true };
}

async function markArtistProcessed(
  client: SupabaseClient,
  channelId: string,
): Promise<{ insertedNew: number; skippedExisting: number }>
{
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

  const insertedNew = preExisting ? 0 : 1;
  const skippedExisting = preExisting ? 1 : 0;
  return { insertedNew, skippedExisting };
}

export async function runArtistSuggestBatch(): Promise<{ processed: number }> {
  const client = getSupabaseAdmin();
  const config = (await fetchInnertubeConfig()) as InnertubeConfig;

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
    const entities = await fetchPrefixEntities(prefix, config);
    const rows = buildRows(prefix, entities);

    const { insertedNew, skippedExisting, attempted, success } = await insertSuggestEntries(client, prefix, rows);
    if (success) {
      insertedNewTotal += insertedNew;
      skippedExistingTotal += skippedExisting;
    }

    const insertedEntities = {
      artist: Boolean(rows.find((r) => r.entity_type === 'artist')),
      album: Boolean(rows.find((r) => r.entity_type === 'album')),
      track: Boolean(rows.find((r) => r.entity_type === 'track')),
      playlist: Boolean(rows.find((r) => r.entity_type === 'playlist')),
    };

    console.log(`${INDEXER_LOG_CONTEXT} prefix_processed`, {
      prefix,
      inserted_entities: insertedEntities,
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
