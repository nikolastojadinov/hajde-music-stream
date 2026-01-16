import { getSupabaseAdmin } from './supabaseClient';

const TABLE_NAME = 'artist_cache_entries';

export type ArtistCacheStatus = 'pending' | 'completed';
type GuardReason = 'already_done';

export type ArtistIngestGuardResult = {
  allowed: boolean;
  reason?: GuardReason;
};

type ArtistCachePayload = {
  status: ArtistCacheStatus;
  ts: string;
  error?: string;
};

export async function canRunFullArtistIngest(artistKey: string): Promise<ArtistIngestGuardResult> {
  const normalizedKey = (artistKey || '').trim();
  if (!normalizedKey) {
    throw new Error('[ArtistIngestGuard] artistKey is required');
  }

  const supabase = getSupabaseAdmin();

  const { data: existing, error: fetchError } = await supabase
    .from(TABLE_NAME)
    .select('payload')
    .eq('artist_key', normalizedKey)
    .maybeSingle();

  if (fetchError) {
    throw new Error(`[ArtistIngestGuard] Failed to read cache entry: ${fetchError.message}`);
  }

  if (existing?.payload?.status === 'completed') {
    return { allowed: false, reason: 'already_done' };
  }

  if (existing?.payload?.status === 'pending') {
    return { allowed: true };
  }

  const payload: ArtistCachePayload = { status: 'pending', ts: new Date().toISOString() };
  const { error: insertError } = await supabase.from(TABLE_NAME).upsert({ artist_key: normalizedKey, payload });

  if (!insertError) {
    return { allowed: true };
  }

  if (insertError.code === '23505') {
    const { data: conflictRow, error: conflictFetchError } = await supabase
      .from(TABLE_NAME)
      .select('payload')
      .eq('artist_key', normalizedKey)
      .maybeSingle();

    if (conflictFetchError) {
      throw new Error(`[ArtistIngestGuard] Failed to load cache entry after conflict: ${conflictFetchError.message}`);
    }

    if (conflictRow?.payload?.status === 'completed') {
      return { allowed: false, reason: 'already_done' };
    }
    return { allowed: true };
  }

  throw new Error(`[ArtistIngestGuard] Failed to insert cache entry: ${insertError.message}`);
}

export async function setArtistIngestStatus(
  artistKey: string,
  status: ArtistCacheStatus,
  errorMessage?: string,
  expectedStatus?: ArtistCacheStatus,
): Promise<boolean> {
  const normalizedKey = (artistKey || '').trim();
  if (!normalizedKey) {
    throw new Error('[ArtistIngestGuard] artistKey is required for status update');
  }

  const supabase = getSupabaseAdmin();
  const now = new Date().toISOString();

  const payload: ArtistCachePayload = {
    status,
    ts: now,
    error: errorMessage,
  };

  const query = supabase.from(TABLE_NAME).update({ payload }).eq('artist_key', normalizedKey);

  if (expectedStatus) {
    query.eq('payload->>status', expectedStatus);
  }

  const { error: updateError, data } = await query.select('artist_key');

  if (updateError) {
    throw new Error(`[ArtistIngestGuard] Failed to update cache entry: ${updateError.message}`);
  }

  return Array.isArray(data) && data.length > 0;
}
