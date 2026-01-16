import { getSupabaseAdmin } from './supabaseClient';

const TABLE_NAME = 'artist_cache_entries';

export type ArtistCacheStatus = 'pending' | 'done' | 'error';
type GuardReason = 'pending' | 'already_done' | 'error';

export type ArtistIngestGuardResult = {
  allowed: boolean;
  reason?: GuardReason;
};

type ArtistCachePayload = {
  status: ArtistCacheStatus;
  started_at: string;
  finished_at?: string;
  error?: string;
};

function extractStatus(payload: ArtistCachePayload | null | undefined, artistKey: string): ArtistCacheStatus {
  const status = payload?.status;
  if (status === 'pending' || status === 'done' || status === 'error') {
    return status;
  }
  throw new Error(`[ArtistIngestGuard] Invalid cache payload for artist ${artistKey}`);
}

function statusToResult(status: ArtistCacheStatus): ArtistIngestGuardResult {
  switch (status) {
    case 'pending':
      return { allowed: false, reason: 'pending' };
    case 'done':
      return { allowed: false, reason: 'already_done' };
    case 'error':
      return { allowed: false, reason: 'error' };
    default:
      return { allowed: false, reason: 'error' };
  }
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

  if (existing) {
    const status = extractStatus(existing.payload as ArtistCachePayload | null, normalizedKey);
    if (status === 'error') {
      const reset = await setArtistIngestStatus(normalizedKey, 'pending', undefined, 'error');
      if (reset) {
        console.log(`[ArtistIngestGuard] reset failed ingest to pending for ${normalizedKey}`);
        return { allowed: true };
      }

      const { data: latest, error: latestError } = await supabase
        .from(TABLE_NAME)
        .select('payload')
        .eq('artist_key', normalizedKey)
        .maybeSingle();

      if (latestError) {
        throw new Error(`[ArtistIngestGuard] Failed to re-read cache entry: ${latestError.message}`);
      }

      const latestStatus = extractStatus(latest?.payload as ArtistCachePayload | null, normalizedKey);
      return statusToResult(latestStatus);
    }
    return statusToResult(status);
  }

  const payload: ArtistCachePayload = {
    status: 'pending',
    started_at: new Date().toISOString(),
  };

  const { error: insertError } = await supabase.from(TABLE_NAME).insert({
    artist_key: normalizedKey,
    payload,
  });

  if (!insertError) {
    console.log(`[ArtistIngestGuard] created pending entry for ${normalizedKey}`);
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

    if (conflictRow) {
      const status = extractStatus(conflictRow.payload as ArtistCachePayload | null, normalizedKey);
      return statusToResult(status);
    }
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

  const { data: existing, error: fetchError } = await supabase
    .from(TABLE_NAME)
    .select('payload')
    .eq('artist_key', normalizedKey)
    .maybeSingle();

  if (fetchError) {
    throw new Error(`[ArtistIngestGuard] Failed to read cache entry for update: ${fetchError.message}`);
  }

  const startedAt = (existing?.payload as ArtistCachePayload | undefined)?.started_at || now;

  const payload: ArtistCachePayload = {
    status,
    started_at: startedAt,
    finished_at: status === 'pending' ? undefined : now,
    error: status === 'error' ? errorMessage || 'full_ingest_failed' : undefined,
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
