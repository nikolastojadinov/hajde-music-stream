import { getSupabaseAdmin } from './supabaseClient';

const TABLE_NAME = 'artist_cache_entries';

type ArtistCacheStatus = 'pending' | 'done' | 'error';
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
