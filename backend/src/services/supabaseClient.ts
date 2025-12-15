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

export type DualPlaylistSearchResult = {
  playlists_by_title: SearchPlaylistRow[];
  playlists_by_artist: SearchPlaylistRow[];
};

export type SearchArtistChannelRow = {
  artist_name: string;
  youtube_channel_id: string | null;
  is_verified: boolean | null;
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

function normalizeQuery(input: unknown): string {
  return typeof input === 'string' ? input.trim() : '';
}

function escapeSqlStringLiteral(value: string): string {
  // Minimal escaping for SQL string literals.
  // - single quotes doubled
  return value.replace(/'/g, "''");
}

function escapeLikePatternLiteral(value: string): string {
  // Escape LIKE wildcards and escape char itself. We'll use: ... ILIKE '<pattern>' ESCAPE '\\'
  // Note: This returns the inner pattern content, not wrapped in quotes.
  return value
    .replace(/\\/g, '\\\\')
    .replace(/%/g, '\\%')
    .replace(/_/g, '\\_')
    .replace(/'/g, "''");
}

export async function searchTracksForQuery(q: string): Promise<SearchTrackRow[]> {
  const query = normalizeQuery(q);
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

export async function searchPlaylistsDualForQuery(q: string): Promise<DualPlaylistSearchResult> {
  const query = normalizeQuery(q);
  if (!supabase || query.length < 2) {
    return { playlists_by_title: [], playlists_by_artist: [] };
  }

  let status: 'ok' | 'error' = 'ok';
  let errorCode: string | null = null;
  let errorMessage: string | null = null;

  try {
    // Use one Supabase call (rpc: run_raw) to fetch both result sets without N+1 loops.
    // Escape input to prevent SQL injection and LIKE wildcard injection.
    const queryLiteral = `'${escapeSqlStringLiteral(query)}'`;
    const likePatternLiteral = `'%${escapeLikePatternLiteral(query)}%'`;

    const sql = `
      with
      title_matches as (
        select p.id, p.title, p.external_id, p.cover_url
        from playlists p
        where p.title ilike ${likePatternLiteral} escape '\\'
        order by
          (lower(p.title) = lower(${queryLiteral})) desc,
          position(lower(${queryLiteral}) in lower(p.title)) asc,
          length(p.title) asc,
          p.title asc
        limit 3
      ),
      artist_matches as (
        select distinct p.id, p.title, p.external_id, p.cover_url
        from tracks t
        join playlist_tracks pt on pt.track_id = t.id
        join playlists p on p.id = pt.playlist_id
        where t.artist ilike ${likePatternLiteral} escape '\\'
        order by p.title asc
        limit 3
      )
      select
        (select coalesce(jsonb_agg(to_jsonb(title_matches)), '[]'::jsonb) from title_matches) as playlists_by_title,
        (select coalesce(jsonb_agg(to_jsonb(artist_matches)), '[]'::jsonb) from artist_matches) as playlists_by_artist
    `;

    const { data, error } = await supabase.rpc('run_raw', { sql });

    if (error) {
      status = 'error';
      errorCode = error.code ? String(error.code) : null;
      errorMessage = error.message ? String(error.message) : 'Supabase playlist search failed';
      return { playlists_by_title: [], playlists_by_artist: [] };
    }

    const row = Array.isArray(data) && data.length > 0 ? (data[0] as any) : null;
    const playlistsByTitle = (row?.playlists_by_title || []) as SearchPlaylistRow[];
    const playlistsByArtist = (row?.playlists_by_artist || []) as SearchPlaylistRow[];

    return {
      playlists_by_title: Array.isArray(playlistsByTitle) ? playlistsByTitle : [],
      playlists_by_artist: Array.isArray(playlistsByArtist) ? playlistsByArtist : [],
    };
  } catch (err: any) {
    status = 'error';
    errorMessage = err?.message ? String(err.message) : 'Supabase playlist search failed';
    return { playlists_by_title: [], playlists_by_artist: [] };
  } finally {
    void logApiUsage({
      apiKeyOrIdentifier: supabaseIdentifier(),
      endpoint: 'supabase.search.playlists.dual',
      quotaCost: 0,
      status,
      errorCode,
      errorMessage,
    });
  }
}

export async function searchArtistChannelsForQuery(q: string): Promise<SearchArtistChannelRow[]> {
  const query = normalizeQuery(q);
  if (!supabase || query.length < 2) return [];

  let status: 'ok' | 'error' = 'ok';
  let errorCode: string | null = null;
  let errorMessage: string | null = null;

  try {
    const result = await supabase
      .from('artist_channels')
      .select('artist_name, youtube_channel_id, is_verified')
      .ilike('artist_name', `%${query}%`)
      .limit(3);

    if (result.error) {
      status = 'error';
      errorCode = result.error.code ? String(result.error.code) : null;
      errorMessage = result.error.message ? String(result.error.message) : 'Supabase artist channel search failed';
      return [];
    }

    return (result.data || []) as SearchArtistChannelRow[];
  } catch (err: any) {
    status = 'error';
    errorMessage = err?.message ? String(err.message) : 'Supabase artist channel search failed';
    return [];
  } finally {
    void logApiUsage({
      apiKeyOrIdentifier: supabaseIdentifier(),
      endpoint: 'supabase.search.artist_channels',
      quotaCost: 0,
      status,
      errorCode,
      errorMessage,
    });
  }
}

export default supabase;
