import supabase from './supabaseClient';

export type ActivityItem = {
  entity_type: string;
  entity_id: string;
  title: string;
  subtitle?: string | null;
  image_url?: string | null;
  external_id?: string | null;
  created_at: string;
};

export type SuggestItem = {
  type: string;
  external_id: string | null;
  title: string;
  subtitle?: string | null;
  image_url?: string | null;
};

export type RecentSearchItem = {
  query: string;
  last_used_at: string;
  use_count: number;
};

const FALLBACK_LIMIT = 15;

const normalize = (value: unknown): string => (typeof value === 'string' ? value.trim() : '');

const isUuid = (value: string): boolean => /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);

const takeUniqueBy = <T>(items: T[], key: (item: T) => string, limit: number): T[] => {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const item of items) {
    const k = key(item);
    if (!k || seen.has(k)) continue;
    seen.add(k);
    out.push(item);
    if (out.length >= limit) break;
  }
  return out;
};

const pickImage = (thumbnail: any): string | null => {
  if (!thumbnail) return null;
  if (typeof thumbnail === 'string') return normalize(thumbnail) || null;
  if (Array.isArray(thumbnail) && thumbnail.length > 0) return normalize(thumbnail[0]);
  if (Array.isArray(thumbnail?.thumbnails) && thumbnail.thumbnails.length > 0) return normalize(thumbnail.thumbnails[0]?.url);
  if (thumbnail?.avatar) return normalize(thumbnail.avatar) || null;
  if (thumbnail?.default) return normalize(thumbnail.default) || null;
  return null;
};

export async function resolveUserIdentity(uidRaw: string): Promise<{ uid: string; userUuid: string | null }> {
  const uid = normalize(uidRaw);
  if (!uid || !supabase) return { uid, userUuid: null };

  const { data, error } = await supabase
    .from('users')
    .select('id, uid, wallet')
    .or(`uid.eq.${uid},wallet.eq.${uid}`)
    .limit(1)
    .maybeSingle();

  if (error) {
    console.error('[localSearch] resolveUserIdentity_failed', { uid, message: error.message });
    return { uid, userUuid: null };
  }

  const userUuid = normalize((data as any)?.id);
  if (!userUuid) {
    console.warn('[localSearch] resolveUserIdentity_missing_id', { uid });
    return { uid, userUuid: null };
  }

  return { uid, userUuid };
}

async function fetchArtistMeta(ids: string[]): Promise<Record<string, { title: string; image: string | null }>> {
  if (!ids.length) return {};
  const { data, error } = await supabase
    .from('artists')
    .select('artist_key, display_name, artist, thumbnails')
    .in('artist_key', ids);
  if (error) {
    console.error('[localSearch] artist_meta_failed', error.message);
    return {};
  }
  const map: Record<string, { title: string; image: string | null }> = {};
  (data || []).forEach((row: any) => {
    const key = normalize(row?.artist_key);
    if (!key) return;
    const title = normalize(row?.display_name) || normalize(row?.artist) || key;
    const image = pickImage(row?.thumbnails) || null;
    map[key] = { title, image };
  });
  return map;
}

async function fetchPlaylistMeta(ids: string[]): Promise<Record<string, { title: string; subtitle: string | null; image: string | null }>> {
  if (!ids.length) return {};
  const { data, error } = await supabase
    .from('playlists')
    .select('external_id, title, cover_url, image_url, channel_title, item_count')
    .in('external_id', ids);
  if (error) {
    console.error('[localSearch] playlist_meta_failed', error.message);
    return {};
  }
  const map: Record<string, { title: string; subtitle: string | null; image: string | null }> = {};
  (data || []).forEach((row: any) => {
    const id = normalize(row?.external_id);
    if (!id) return;
    const title = normalize(row?.title) || id;
    const subtitle = normalize(row?.channel_title) || (row?.item_count ? `${row.item_count} items` : '') || null;
    const image = normalize(row?.cover_url) || normalize(row?.image_url) || null;
    map[id] = { title, subtitle, image };
  });
  return map;
}

async function fetchTrackMeta(ids: string[]): Promise<Record<string, { title: string; subtitle: string | null; image: string | null }>> {
  if (!ids.length) return {};
  const { data, error } = await supabase
    .from('tracks')
    .select('youtube_id, title, artist, cover_url, image_url')
    .in('youtube_id', ids);
  if (error) {
    console.error('[localSearch] track_meta_failed', error.message);
    return {};
  }
  const map: Record<string, { title: string; subtitle: string | null; image: string | null }> = {};
  (data || []).forEach((row: any) => {
    const id = normalize(row?.youtube_id);
    if (!id) return;
    const title = normalize(row?.title) || id;
    const subtitle = normalize(row?.artist) || null;
    const image = normalize(row?.cover_url) || normalize(row?.image_url) || null;
    map[id] = { title, subtitle, image };
  });
  return map;
}

async function fetchAlbumMeta(ids: string[]): Promise<Record<string, { title: string; subtitle: string | null; image: string | null }>> {
  if (!ids.length) return {};
  const { data, error } = await supabase
    .from('albums')
    .select('external_id, title, artist_key, cover_url, thumbnail_url, release_date')
    .in('external_id', ids);
  if (error) {
    console.error('[localSearch] album_meta_failed', error.message);
    return {};
  }
  const map: Record<string, { title: string; subtitle: string | null; image: string | null }> = {};
  (data || []).forEach((row: any) => {
    const id = normalize(row?.external_id);
    if (!id) return;
    const title = normalize(row?.title) || id;
    const year = row?.release_date ? String(row.release_date).slice(0, 4) : '';
    const subtitle = year || normalize(row?.artist_key) || null;
    const image = normalize(row?.cover_url) || normalize(row?.thumbnail_url) || null;
    map[id] = { title, subtitle, image };
  });
  return map;
}

function mergeMeta(
  items: Array<{ entity_type: string; entity_id: string; created_at: string }>,
  meta: {
    artists: Record<string, { title: string; image: string | null }>;
    playlists: Record<string, { title: string; subtitle: string | null; image: string | null }>;
    tracks: Record<string, { title: string; subtitle: string | null; image: string | null }>;
    albums: Record<string, { title: string; subtitle: string | null; image: string | null }>;
  },
): ActivityItem[] {
  return items.map((row) => {
    const key = normalize(row.entity_id);
    const type = normalize(row.entity_type).toLowerCase();

    if (type === 'artist') {
      const m = meta.artists[key];
      return {
        entity_type: 'artist',
        entity_id: key,
        title: m?.title || key,
        image_url: m?.image || null,
        external_id: key,
        created_at: row.created_at,
      };
    }

    if (type === 'playlist') {
      const m = meta.playlists[key];
      return {
        entity_type: 'playlist',
        entity_id: key,
        title: m?.title || key,
        subtitle: m?.subtitle || null,
        image_url: m?.image || null,
        external_id: key,
        created_at: row.created_at,
      };
    }

    if (type === 'album') {
      const m = meta.albums[key];
      return {
        entity_type: 'album',
        entity_id: key,
        title: m?.title || key,
        subtitle: m?.subtitle || null,
        image_url: m?.image || null,
        external_id: key,
        created_at: row.created_at,
      };
    }

    if (type === 'track' || type === 'song') {
      const m = meta.tracks[key];
      return {
        entity_type: 'track',
        entity_id: key,
        title: m?.title || key,
        subtitle: m?.subtitle || null,
        image_url: m?.image || null,
        external_id: key,
        created_at: row.created_at,
      };
    }

    return {
      entity_type: type || 'generic',
      entity_id: key,
      title: key,
      image_url: null,
      external_id: key,
      created_at: row.created_at,
    };
  });
}

export async function fetchActivity(userId: string, limit = FALLBACK_LIMIT): Promise<ActivityItem[]> {
  const uid = normalize(userId);
  if (!uid || !supabase) return [];

  const { data, error } = await supabase
    .from('user_activity_history')
    .select('entity_type,entity_id,created_at')
    .eq('user_id', uid)
    .order('created_at', { ascending: false })
    .limit(limit * 5);

  if (error) {
    console.error('[localSearch] activity_query_failed', error.message);
    return [];
  }

  const rows = takeUniqueBy(data || [], (row) => `${normalize(row.entity_type)}|${normalize(row.entity_id)}`, limit);

  const artistIds = rows.filter((r) => normalize(r.entity_type) === 'artist').map((r) => normalize(r.entity_id));
  const playlistIds = rows.filter((r) => normalize(r.entity_type) === 'playlist').map((r) => normalize(r.entity_id));
  const albumIds = rows.filter((r) => normalize(r.entity_type) === 'album').map((r) => normalize(r.entity_id));
  const trackIds = rows.filter((r) => ['track', 'song'].includes(normalize(r.entity_type))).map((r) => normalize(r.entity_id));

  const [artistMeta, playlistMeta, albumMeta, trackMeta] = await Promise.all([
    fetchArtistMeta(artistIds),
    fetchPlaylistMeta(playlistIds),
    fetchAlbumMeta(albumIds),
    fetchTrackMeta(trackIds),
  ]);

  return mergeMeta(rows, { artists: artistMeta, playlists: playlistMeta, albums: albumMeta, tracks: trackMeta });
}

export async function writeActivity(params: { userId: string; entityType: string; entityId: string; context?: unknown }): Promise<'inserted' | 'skipped_duplicate'> {
  const userId = normalize(params.userId);
  const entityType = normalize(params.entityType);
  const entityId = normalize(params.entityId);
  if (!userId || !entityType || !entityId || !supabase) return 'skipped_duplicate';

  const { data: lastRows, error: lastError } = await supabase
    .from('user_activity_history')
    .select('entity_type, entity_id')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(1);

  if (!lastError && Array.isArray(lastRows) && lastRows.length === 1) {
    const last = lastRows[0];
    if (normalize(last?.entity_type) === entityType && normalize(last?.entity_id) === entityId) {
      console.info('[localSearch] activity_skipped_duplicate', { userId, entityType, entityId });
      return 'skipped_duplicate';
    }
  }

  const context = params.context === undefined || params.context === null ? null : JSON.stringify(params.context);

  const { error } = await supabase.from('user_activity_history').insert({
    user_id: userId,
    entity_type: entityType,
    entity_id: entityId,
    context,
  });

  if (error) {
    console.error('[localSearch] activity_insert_failed', { message: error.message });
    return 'skipped_duplicate';
  }

  return 'inserted';
}

export async function fetchRecentSearches(userUuid: string, limit = FALLBACK_LIMIT): Promise<RecentSearchItem[]> {
  const userId = normalize(userUuid);
  if (!userId || !isUuid(userId) || !supabase) {
    console.warn('[localSearch] recent_searches_invalid_user', { userId });
    return [];
  }

  const { data, error } = await supabase
    .from('user_recent_searches')
    .select('query,last_used_at,use_count')
    .eq('user_id', userId)
    .order('last_used_at', { ascending: false })
    .limit(limit);

  if (error) {
    console.error('[localSearch] recent_searches_failed', error.message);
    return [];
  }

  return (data || []).map((row: any) => ({
    query: normalize(row?.query),
    last_used_at: row?.last_used_at || row?.created_at || '',
    use_count: Number(row?.use_count) || 0,
  }));
}

export async function upsertRecentSearch(userUuid: string, queryRaw: string): Promise<'ok' | 'error'> {
  const userId = normalize(userUuid);
  const query = normalize(queryRaw);
  if (!userId || !isUuid(userId) || !query || !supabase) {
    console.warn('[localSearch] recent_search_upsert_invalid', { userId, query });
    return 'error';
  }

  const normalizedQuery = query.toLowerCase();

  const { error } = await supabase.from('user_recent_searches').upsert(
    {
      user_id: userId,
      query,
      entity_type: 'generic',
      last_used_at: new Date().toISOString(),
      use_count: 1,
      normalized_query: normalizedQuery,
    },
    { onConflict: 'user_id,query' },
  );

  if (error) {
    console.error('[localSearch] recent_search_upsert_failed', error.message);
    return 'error';
  }

  return 'ok';
}

export async function fetchLocalSuggest(q: string, limit = 10): Promise<SuggestItem[]> {
  const query = normalize(q);
  if (!query || !supabase) return [];

  const likeValue = `${query.toLowerCase()}%`;

  const { data, error } = await supabase
    .from('suggest_entries')
    .select('query, normalized_query, entity_type, external_id, results, meta')
    .or(`normalized_query.ilike.${likeValue},query.ilike.${likeValue}`)
    .order('last_seen_at', { ascending: false })
    .limit(limit);

  if (error) {
    console.error('[localSearch] suggest_query_failed', error.message);
    return [];
  }

  return (data || []).map((row: any) => {
    const title = normalize(row?.query) || normalize(row?.normalized_query) || query;
    const meta = row?.meta || {};
    let image: string | null = null;
    if (meta?.image_url) image = normalize(meta.image_url) || null;
    else if (meta?.thumbnail_url) image = normalize(meta.thumbnail_url) || null;

    let subtitle: string | null = null;
    if (meta?.subtitle) subtitle = normalize(meta.subtitle) || null;
    else if (meta?.channel_title) subtitle = normalize(meta.channel_title) || null;

    return {
      type: normalize(row?.entity_type) || 'generic',
      external_id: normalize(row?.external_id) || null,
      title: title || query,
      subtitle,
      image_url: image,
    } satisfies SuggestItem;
  });
}
