import { canonicalArtistName, normalizeArtistKey } from '../utils/artistKey';
import { isDuplicateConstraint } from '../lib/dbErrors';
import { getSupabaseAdmin } from './supabaseClient';

export type ArtistInput = {
  name: string;
  channelId?: string | null;
  thumbnails?: { avatar?: string | null; banner?: string | null };
  source?: string | null;
  artistDescription?: string | null;
};

export type ArtistResult = { keys: string[]; count: number };

const NOW = () => new Date().toISOString();

function normalize(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeKey(value: string | null | undefined): string {
  const base = normalize(value);
  const normalized = normalizeArtistKey(base);
  return normalized || base;
}

function normalizeArtistDisplayName(name: string): string {
  return normalize(canonicalArtistName(name)) || normalize(name);
}

function normalizeNameForLookup(value: string | null | undefined): string {
  return normalizeKey(value).toLowerCase();
}

function uniqueBy<T>(items: T[], keyFn: (item: T) => string): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  items.forEach((item) => {
    const key = keyFn(item);
    if (!key || seen.has(key)) return;
    seen.add(key);
    out.push(item);
  });
  return out;
}

function uniqueKeys(values: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  values.forEach((value) => {
    const key = normalizeKey(value);
    if (!key) return;
    const token = key.toLowerCase();
    if (seen.has(token)) return;
    seen.add(token);
    out.push(key);
  });
  return out;
}

async function loadChannelKeyMap(channelIds: string[]): Promise<Record<string, string>> {
  if (!channelIds.length) return {};
  const client = getSupabaseAdmin();
  const { data, error } = await client
    .from('artists')
    .select('artist_key, youtube_channel_id')
    .in('youtube_channel_id', channelIds);
  if (error) throw new Error(`[upsertArtists] channel lookup ${error.message}`);

  const map: Record<string, string> = {};
  (data || []).forEach((row: any) => {
    const channel = normalize(row.youtube_channel_id);
    const key = normalize(row.artist_key);
    if (channel && key) map[channel] = key;
  });
  return map;
}

async function loadExistingByNormalizedName(normalizedNames: string[]): Promise<Record<string, any>> {
  if (!normalizedNames.length) return {};
  const client = getSupabaseAdmin();
  const { data, error } = await client
    .from('artists')
    .select('artist_key, normalized_name, youtube_channel_id')
    .in('normalized_name', normalizedNames);

  if (error) throw new Error(`[upsertArtists] normalized lookup ${error.message}`);

  const map: Record<string, any> = {};
  (data || []).forEach((row: any) => {
    const normalized = normalizeNameForLookup(row?.normalized_name);
    if (normalized && !map[normalized]) map[normalized] = row;
  });
  return map;
}

async function ensureChannelOnExisting(
  normalizedName: string,
  desiredChannelId: string | null,
  existing: { youtube_channel_id?: string | null } | undefined,
): Promise<void> {
  const channelId = normalize(desiredChannelId) || null;
  if (!channelId || !existing || existing.youtube_channel_id) return;
  const client = getSupabaseAdmin();
  const { error } = await client
    .from('artists')
    .update({ youtube_channel_id: channelId, updated_at: NOW() })
    .eq('normalized_name', normalizedName);
  if (error) console.warn('[upsertArtists] channel_update_skip', { normalized_name: normalizedName, message: error.message });
  else existing.youtube_channel_id = channelId;
}

function buildArtistRow(
  input: ArtistInput,
  channelMap: Record<string, string>,
  sourceHint?: string,
): {
  artist_key: string;
  normalized_name: string;
  artist: string;
  display_name: string;
  youtube_channel_id: string | null;
  thumbnails: any;
  source: string | null;
  artist_description: string | null;
  created_at: string;
  updated_at: string;
} {
  const displayName = normalizeArtistDisplayName(input.name);
  const baseKey = normalizeArtistKey(displayName || input.name || '');
  const channelId = normalize(input.channelId) || null;
  const canonicalKey = channelId && channelMap[channelId] ? channelMap[channelId] : baseKey;
  const normalizedName = normalizeNameForLookup(canonicalKey || displayName || baseKey);

  return {
    artist_key: canonicalKey,
    normalized_name: normalizedName,
    artist: displayName || canonicalKey,
    display_name: displayName || canonicalKey,
    youtube_channel_id: channelId,
    thumbnails: input.thumbnails || null,
    source: normalize(input.source) || normalize(sourceHint) || 'ingest',
    artist_description: normalize(input.artistDescription) || null,
    created_at: NOW(),
    updated_at: NOW(),
  };
}

export async function upsertArtists(inputs: ArtistInput[], sourceHint?: string): Promise<ArtistResult> {
  if (!inputs.length) return { keys: [], count: 0 };
  const client = getSupabaseAdmin();

  const uniqueInputs = uniqueBy(inputs, (artist) => `${normalize(artist.channelId) || ''}::${normalize(artist.name)}`);
  if (!uniqueInputs.length) return { keys: [], count: 0 };

  const channelIds = Array.from(new Set(uniqueInputs.map((a) => normalize(a.channelId)).filter((v) => Boolean(v))));
  const channelMap = await loadChannelKeyMap(channelIds);

  const rows = uniqueBy(
    uniqueInputs
      .map((artist) => buildArtistRow(artist, channelMap, sourceHint))
      .filter(Boolean),
    (row) => row.normalized_name,
  );

  if (!rows.length) return { keys: [], count: 0 };

  const existingMap = await loadExistingByNormalizedName(rows.map((r) => r.normalized_name));
  const keys: string[] = [];

  for (const row of rows) {
    const normalizedName = normalizeNameForLookup(row.normalized_name);
    const existing = existingMap[normalizedName];

    if (existing) {
      await ensureChannelOnExisting(normalizedName, row.youtube_channel_id, existing);
      keys.push(normalizeKey(existing.artist_key));
      continue;
    }

    const { data, error } = await client
      .from('artists')
      .insert(row)
      .select('artist_key, normalized_name, youtube_channel_id')
      .maybeSingle();

    if (error) {
      if (isDuplicateConstraint(error, 'artists_canonical_unique') || isDuplicateConstraint(error)) {
        console.info('[upsertArtists] artist_exists_skip', {
          artist_key: row.artist_key,
          channel: row.youtube_channel_id ?? null,
        });

        const { data: existingRow } = await client
          .from('artists')
          .select('artist_key, normalized_name, youtube_channel_id')
          .eq('normalized_name', normalizedName)
          .maybeSingle();

        if (existingRow) {
          existingMap[normalizedName] = existingRow;
          await ensureChannelOnExisting(normalizedName, row.youtube_channel_id, existingRow as any);
          keys.push(normalizeKey((existingRow as any).artist_key));
          continue;
        }

        keys.push(normalizeKey(row.artist_key));
        continue;
      }

      throw new Error(`[upsertArtists] insert ${error.message}`);
    }

    const artistKey = normalizeKey((data as any)?.artist_key || row.artist_key);
    existingMap[normalizedName] = data as any;
    keys.push(artistKey);
  }

  const unique = uniqueKeys(keys);
  return { keys: unique, count: unique.length };
}
