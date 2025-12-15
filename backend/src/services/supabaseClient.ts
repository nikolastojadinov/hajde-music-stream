import { createClient, SupabaseClient } from '@supabase/supabase-js';
import env from '../environments';
import { logApiUsage } from './apiUsageLogger';

export type SearchTrackRow = {
  id: string;
  title: string;
  artist: string;
  external_id: string | null;
  cover_url: string | null;
  duration: number | null;
};

export type SearchPlaylistRow = {
  id: string;
  title: string;
  external_id: string | null;
  cover_url: string | null;
};

let supabase: SupabaseClient;

if (env.supabase_url && env.supabase_service_role_key) {
  supabase = createClient(env.supabase_url, env.supabase_service_role_key, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: {
      headers: {
        apikey: env.supabase_service_role_key,
        Authorization: `Bearer ${env.supabase_service_role_key}`,
      },
    },
  });
} else {
  console.warn('Supabase credentials missing; set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY');
  // @ts-expect-error intentionally undefined until env provided
  supabase = undefined;
}

function supabaseIdentifier(): string {
  // Hash a stable identifier (URL) rather than the service role key.
  return env.supabase_url || 'unknown-supabase';
}

export async function searchTracksForQuery(q: string): Promise<SearchTrackRow[]> {
  const query = typeof q === 'string' ? q.trim() : '';
  if (!supabase || query.length < 2) return [];

  let status: 'ok' | 'error' = 'ok';
  let errorCode: string | null = null;
  let errorMessage: string | null = null;

  try {
    const result = await supabase
      .from('tracks')
      .select('id, title, artist, external_id, cover_url, duration')
      .or(`title.ilike.%${query}%,artist.ilike.%${query}%`)
      .limit(10);

    if (result.error) {
      status = 'error';
      errorCode = result.error.code ? String(result.error.code) : null;
      errorMessage = result.error.message ? String(result.error.message) : 'Supabase search failed';
      return [];
    }

    return (result.data || []) as SearchTrackRow[];
  } catch (err: any) {
    status = 'error';
    errorMessage = err?.message ? String(err.message) : 'Supabase search failed';
    return [];
  } finally {
    void logApiUsage({
      apiKeyOrIdentifier: supabaseIdentifier(),
      endpoint: 'supabase.search',
      quotaCost: 0,
      status,
      errorCode,
      errorMessage,
    });
  }
}

export async function searchPlaylistsForQuery(q: string): Promise<SearchPlaylistRow[]> {
  const query = typeof q === 'string' ? q.trim() : '';
  if (!supabase || query.length < 2) return [];

  let status: 'ok' | 'error' = 'ok';
  let errorCode: string | null = null;
  let errorMessage: string | null = null;

  try {
    const result = await supabase
      .from('playlists')
      .select('id, title, external_id, cover_url')
      .ilike('title', `%${query}%`)
      .limit(10);

    if (result.error) {
      status = 'error';
      errorCode = result.error.code ? String(result.error.code) : null;
      errorMessage = result.error.message ? String(result.error.message) : 'Supabase search failed';
      return [];
    }

    return (result.data || []) as SearchPlaylistRow[];
  } catch (err: any) {
    status = 'error';
    errorMessage = err?.message ? String(err.message) : 'Supabase search failed';
    return [];
  } finally {
    void logApiUsage({
      apiKeyOrIdentifier: supabaseIdentifier(),
      endpoint: 'supabase.search',
      quotaCost: 0,
      status,
      errorCode,
      errorMessage,
    });
  }
}

export default supabase;
