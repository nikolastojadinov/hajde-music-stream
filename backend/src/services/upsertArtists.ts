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

function buildArtistRow(
  input: ArtistInput,
  channelMap: Record<string, string>,
  sourceHint?: string,
): { artist_key: string; normalized_name: string; artist: string; display_name: string; youtube_channel_id: string | null; thumbnails: any; source: string | null; artist_description: string | null; created_at: string; updated_at: string } {
  const displayName = normalizeArtistDisplayName(input.name);
  const baseKey = normalizeArtistKey(displayName || input.name || '');
  const channelId = normalize(input.channelId) || null;
  const canonicalKey = channelId && channelMap[channelId] ? channelMap[channelId] : baseKey;
  const normalizedName = normalizeKey(displayName || baseKey);

  return {
    artist_key: canonicalKey,
    normalized_name: normalizedName.toLowerCase(),
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

  const channelIds = Array.from(
    new Set(uniqueInputs.map((a) => normalize(a.channelId)).filter((v) => Boolean(v)))
  );
  const channelMap = await loadChannelKeyMap(channelIds);

  const rows = uniqueBy(
    uniqueInputs
      .map((artist) => buildArtistRow(artist, channelMap, sourceHint))
      .filter(Boolean),
    (row) => row.artist_key,
  );

  const keys: string[] = [];

  for (const row of rows) {
    const { data, error } = await client
      .from('artists')
      .insert(row)
      .select('artist_key, youtube_channel_id')
      .maybeSingle();

    if (error) {
      if (isDuplicateConstraint(error, 'artists_canonical_unique') || isDuplicateConstraint(error)) {
        console.info('[upsertArtists] artist_exists_skip', {
          artist_key: row.artist_key,
          channel: row.youtube_channel_id ?? null,
        });
        keys.push(row.artist_key);
        continue;
      }
      throw new Error(`[upsertArtists] insert ${error.message}`);
    }

    const artistKey = normalizeKey((data as any)?.artist_key || row.artist_key);
    keys.push(artistKey);
  }

  const unique = uniqueKeys(keys);
  return { keys: unique, count: unique.length };
}
