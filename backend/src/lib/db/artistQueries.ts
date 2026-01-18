import { getSupabaseAdmin } from '../../services/supabaseClient';

export type UnresolvedArtistCandidate = {
  artistKey: string;
  normalizedName: string;
  displayName: string | null;
};

export type ArtistChannelWriteResult = {
  artistKey: string;
  youtubeChannelId: string;
  existed: boolean;
  updated: boolean;
  previousChannelId: string | null;
};

export type ArtistDescriptionWriteResult = {
  updated: boolean;
};

const ARTIST_LOCK_KEY = 723994;

type RawRow = { payload?: any };

function normalize(value: string | null | undefined): string {
  return typeof value === 'string' ? value.trim() : '';
}

function nowIso(): string {
  return new Date().toISOString();
}

async function runJsonQuery<T>(sql: string, label: string): Promise<T | null> {
  const client = getSupabaseAdmin();
  const { data, error } = await client.rpc('run_raw', { sql });

  if (error) throw new Error(`[artistQueries] ${label} failed: ${error.message}`);
  if (!Array.isArray(data) || data.length === 0) return null;

  const payload = (data[0] as RawRow)?.payload;
  if (payload === null || payload === undefined) return null;
  return payload as T;
}

async function runBooleanQuery(sql: string, label: string): Promise<boolean> {
  const result = await runJsonQuery<{ value: boolean }>(sql, label);
  if (result === null) return false;
  if (typeof (result as any) === 'boolean') return result as unknown as boolean;
  if (typeof (result as any).value === 'boolean') return (result as any).value;
  return Boolean(result);
}

export async function persistArtistChannelId(params: {
  artistKey: string;
  youtubeChannelId: string;
  displayName?: string;
  artistDescription?: string | null;
}): Promise<ArtistChannelWriteResult> {
  const artistKey = normalize(params.artistKey);
  const youtubeChannelId = normalize(params.youtubeChannelId);
  const displayName = normalize(params.displayName || params.artistKey);
  const incomingDescription = normalize(params.artistDescription || '');
  if (!artistKey) throw new Error('[artistQueries] artistKey is required');
  if (!youtubeChannelId) throw new Error('[artistQueries] youtubeChannelId is required');

  const client = getSupabaseAdmin();
  const { data, error } = await client
    .from('artists')
    .select('artist_key, youtube_channel_id, display_name, normalized_name, artist, artist_description')
    .eq('artist_key', artistKey)
    .limit(1);

  if (error) throw new Error(`[artistQueries] artist lookup failed: ${error.message}`);

  const existing = Array.isArray(data) && data.length > 0 ? data[0] : null;
  const previousChannelId = existing?.youtube_channel_id ?? null;

  if (!existing) {
    const normalizedName = displayName ? displayName.toLowerCase() : artistKey.toLowerCase();
    const insertRow = {
      artist_key: artistKey,
      artist: displayName || artistKey,
      display_name: displayName || artistKey,
      normalized_name: normalizedName,
      youtube_channel_id: youtubeChannelId,
      artist_description: incomingDescription || null,
      updated_at: nowIso(),
    };

    const { error: insertError } = await client.from('artists').upsert(insertRow, { onConflict: 'artist_key' });
    if (insertError) throw new Error(`[artistQueries] artist insert failed: ${insertError.message}`);

    return { artistKey, youtubeChannelId, existed: false, updated: true, previousChannelId };
  }

  const existingDescription = normalize((existing as any)?.artist_description);
  const shouldWriteDescription = !existingDescription && incomingDescription;

  if (previousChannelId === youtubeChannelId) {
    const updates: Record<string, any> = { updated_at: nowIso() };
    if (shouldWriteDescription) updates.artist_description = incomingDescription;

    const { error: touchError } = await client.from('artists').update(updates).eq('artist_key', artistKey);
    if (touchError) throw new Error(`[artistQueries] artist touch failed: ${touchError.message}`);
    return { artistKey, youtubeChannelId, existed: true, updated: Boolean(shouldWriteDescription), previousChannelId };
  }

  const updates: Record<string, any> = {
    youtube_channel_id: youtubeChannelId,
    updated_at: nowIso(),
  };

  if (shouldWriteDescription) updates.artist_description = incomingDescription;

  if (!existing.display_name) updates.display_name = displayName || artistKey;
  if (!existing.normalized_name) updates.normalized_name = (displayName || artistKey).toLowerCase();
  if (!existing.artist) updates.artist = displayName || artistKey;

  const { error: updateError } = await client.from('artists').update(updates).eq('artist_key', artistKey);
  if (updateError) throw new Error(`[artistQueries] artist channel update failed: ${updateError.message}`);

  return { artistKey, youtubeChannelId, existed: true, updated: true, previousChannelId };
}

export async function persistArtistDescription(params: { artistKey: string; description: string }): Promise<ArtistDescriptionWriteResult> {
  const artistKey = normalize(params.artistKey);
  const description = normalize(params.description).replace(/\s+/g, ' ');
  if (!artistKey) throw new Error('[artistQueries] artistKey is required');
  if (!description) return { updated: false };

  const client = getSupabaseAdmin();
  const { data, error } = await client
    .from('artists')
    .update({ artist_description: description, updated_at: nowIso() })
    .eq('artist_key', artistKey)
    .or('artist_description.is.null,artist_description.eq.""')
    .select('artist_key');

  if (error) throw new Error(`[artistQueries] artist description update failed: ${error.message}`);

  const updated = Array.isArray(data) && data.length > 0;
  return { updated };
}

export async function markResolveAttempt(artistKey: string): Promise<void> {
  const key = normalize(artistKey);
  if (!key) return;
  const client = getSupabaseAdmin();
  const { error } = await client
    .from('artists')
    .update({ last_resolve_attempt_at: nowIso(), updated_at: nowIso() })
    .eq('artist_key', key);
  if (error) throw new Error(`[artistQueries] markResolveAttempt failed: ${error.message}`);
}

export async function claimNextUnresolvedArtist(): Promise<UnresolvedArtistCandidate | null> {
  const sql = `
WITH candidate AS (
  SELECT artist_key, normalized_name, display_name
  FROM public.artists
  WHERE youtube_channel_id IS NULL
  ORDER BY COALESCE(last_resolve_attempt_at, updated_at, created_at) ASC NULLS FIRST, created_at ASC
  LIMIT 1
  FOR UPDATE SKIP LOCKED
)
SELECT to_jsonb(candidate) AS payload FROM candidate;
`;

  const row = await runJsonQuery<UnresolvedArtistCandidate>(sql, 'claimNextUnresolvedArtist');
  if (!row) return null;
  const raw = row as any;
  const key = normalize(raw.artist_key ?? raw.artistKey);
  if (!key) return null;
  return {
    artistKey: key,
    normalizedName: normalize(raw.normalized_name ?? raw.normalizedName),
    displayName: normalize(raw.display_name ?? raw.displayName) || null,
  };
}

export async function tryAcquireUnresolvedArtistLock(): Promise<boolean> {
  const sql = `SELECT to_jsonb(pg_try_advisory_lock(${ARTIST_LOCK_KEY})) AS payload;`;
  return runBooleanQuery(sql, 'tryAcquireUnresolvedArtistLock');
}

export async function releaseUnresolvedArtistLock(): Promise<void> {
  const sql = `SELECT to_jsonb(pg_advisory_unlock(${ARTIST_LOCK_KEY})) AS payload;`;
  await runBooleanQuery(sql, 'releaseUnresolvedArtistLock');
}
