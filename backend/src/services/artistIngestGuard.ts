import { getSupabaseAdmin } from './supabaseClient';

const TABLE_NAME = 'artist_cache_entries';

export type ArtistCacheStatus = 'pending' | 'completed';
type GuardReason = 'already_done' | 'already_running';

export type ArtistIngestGuardResult = {
  allowed: boolean;
  reason?: GuardReason;
};

type ArtistCachePayload = {
  status: ArtistCacheStatus;
  ts: string;
  error?: string;
};

function extractStatus(payload: any): ArtistCacheStatus | null {
  if (payload && typeof payload === 'object') {
    const status = (payload as any).status;
    if (status === 'pending' || status === 'completed') return status;
  }
  return null;
}

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

  const payloadStatus = extractStatus(existing?.payload);

  const { count: linkedCount } = await supabase
    .from('artist_tracks')
    .select('track_id', { count: 'exact', head: true })
    .eq('artist_key', normalizedKey);

  if (payloadStatus === 'completed' && (linkedCount || 0) > 0) {
    return { allowed: false, reason: 'already_done' };
  }

  if (payloadStatus === 'pending') {
    return { allowed: false, reason: 'already_running' };
  }

  const payload: ArtistCachePayload = { status: 'pending', ts: new Date().toISOString() };

  const { error: insertError } = await supabase.from(TABLE_NAME).insert({ artist_key: normalizedKey, payload });

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

    const conflictStatus = extractStatus(conflictRow?.payload);
    if (conflictStatus === 'completed' && (linkedCount || 0) > 0) return { allowed: false, reason: 'already_done' };
    if (conflictStatus === 'pending') return { allowed: false, reason: 'already_running' };
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
