import supabase from '../services/supabaseClient';

export type SearchSessionRow = {
  user_id: string;
  query: string;
  results_snapshot: unknown;
  created_at: string;
  expires_at: string;
};

const FIFTEEN_MINUTES_MS = 15 * 60 * 1000;

export async function saveSearchSession({
  userId,
  query,
  results,
}: {
  userId: string | null | undefined;
  query: string | null | undefined;
  results: unknown;
}): Promise<void> {
  const userIdValue = typeof userId === 'string' ? userId.trim() : '';
  const queryValue = typeof query === 'string' ? query.trim() : '';

  if (!userIdValue || !queryValue || !supabase) return;

  const expiresAt = new Date(Date.now() + FIFTEEN_MINUTES_MS).toISOString();

  try {
    const { error } = await supabase.from('user_search_sessions').insert({
      user_id: userIdValue,
      query: queryValue,
      results_snapshot: results ?? null,
      expires_at: expiresAt,
    });

    if (error) {
      console.error('[searchSessionManager] failed to save session', {
        userId: userIdValue,
        query: queryValue,
        message: error.message,
      });
    }
  } catch (err) {
    console.error('[searchSessionManager] unexpected save error', {
      userId: userIdValue,
      query: queryValue,
      message: err instanceof Error ? err.message : String(err),
    });
  }
}

export async function getLastValidSearchSession({ userId }: { userId: string | null | undefined }): Promise<SearchSessionRow | null> {
  const userIdValue = typeof userId === 'string' ? userId.trim() : '';
  if (!userIdValue || !supabase) return null;

  const nowIso = new Date().toISOString();

  try {
    const { data, error } = await supabase
      .from('user_search_sessions')
      .select('user_id,query,results_snapshot,created_at,expires_at')
      .eq('user_id', userIdValue)
      .gt('expires_at', nowIso)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error && error.code !== 'PGRST116') {
      console.error('[searchSessionManager] failed to load session', {
        userId: userIdValue,
        message: error.message,
      });
      return null;
    }

    if (!data) return null;
    return data as SearchSessionRow;
  } catch (err) {
    console.error('[searchSessionManager] unexpected load error', {
      userId: userIdValue,
      message: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}
