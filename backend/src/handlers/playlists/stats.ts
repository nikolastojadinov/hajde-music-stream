import { Request, Response } from 'express';
import supabase from '../../services/supabaseClient';

interface PublicStatsResponse {
  likes: number;
  views: number;
}

const statsCache = new Map<string, { payload: PublicStatsResponse; ts: number }>();
const STATS_TTL_MS = 4000;
const viewDeduper = new Map<string, number>();
const VIEW_TTL_MS = 4000;
const TEN_SECONDS_MS = 10_000;

const getStatsCacheKey = (playlistId: string) => `public_stats:${playlistId}`;

function getRequestUserId(req: Request): string | null {
  if (req.currentUser?.uid) {
    return req.currentUser.uid;
  }

  const piAuthUser = (req as any).user as { id?: string } | undefined;
  if (piAuthUser?.id) {
    return piAuthUser.id;
  }

  const headerUser = req.headers['x-pi-user-id'];
  if (typeof headerUser === 'string' && headerUser.trim().length > 0) {
    return headerUser;
  }

  return null;
}

async function mapWalletToInternalUserId(wallet: string): Promise<string | null> {
  if (!wallet) return null;
  if (!supabase) return null;

  try {
    const { data, error } = await supabase
      .from('users')
      .select('id')
      .eq('wallet', wallet)
      .limit(1)
      .maybeSingle();

    if (error) {
      console.error('[playlist_stats] Failed to map wallet to internal id', error);
      return null;
    }

    return data?.id ?? null;
  } catch (err) {
    console.error('[playlist_stats] Unexpected error mapping wallet', err);
    return null;
  }
}

async function fetchPlaylistStats(playlistId: string): Promise<PublicStatsResponse> {
  const cacheKey = getStatsCacheKey(playlistId);
  const cached = statsCache.get(cacheKey);
  const now = Date.now();
  if (cached && now - cached.ts < STATS_TTL_MS) {
    return cached.payload;
  }

  const { data, error } = await supabase!
    .from('playlist_stats')
    .select('public_like_count, public_view_count')
    .eq('playlist_id', playlistId)
    .maybeSingle();

  if (error && error.code !== 'PGRST116') {
    throw error;
  }

  const payload = {
    likes: data?.public_like_count ?? 0,
    views: data?.public_view_count ?? 0,
  };

  statsCache.set(cacheKey, { payload, ts: now });
  return payload;
}

export async function getPublicPlaylistStats(req: Request, res: Response) {
  const playlistId = req.params.id;

  if (!playlistId) {
    return res.status(400).json({ error: 'playlist_id_required' });
  }

  if (!supabase) {
    return res.status(500).json({ error: 'supabase_not_initialized' });
  }

  try {
    const payload = await fetchPlaylistStats(playlistId);
    return res.json(payload);
  } catch (error) {
    console.error('[getPublicPlaylistStats] Failed to fetch stats', error);
    return res.status(500).json({ error: 'public_stats_query_failed' });
  }
}

export async function registerPlaylistView(req: Request, res: Response) {
  const playlistId = req.params.id;

  if (!playlistId) {
    return res.status(400).json({ error: 'playlist_id_required' });
  }

  const viewerWallet = getRequestUserId(req);

  if (!viewerWallet) {
    return res.status(401).json({ error: 'user_not_authenticated' });
  }

  if (!supabase) {
    return res.status(500).json({ error: 'supabase_not_initialized' });
  }

  try {
    const internalUserId = await mapWalletToInternalUserId(viewerWallet);

    if (!internalUserId) {
      return res.status(500).json({ error: 'viewer_internal_id_missing' });
    }

    const now = Date.now();

    const dedupeKey = `${internalUserId}:${playlistId}`;
    const lastView = viewDeduper.get(dedupeKey) ?? 0;
    if (now - lastView < VIEW_TTL_MS) {
      console.info('[registerPlaylistView] view deduplicated', { user_id: internalUserId, playlist_id: playlistId, reason: 'recent_window' });
      const cachedStats = statsCache.get(getStatsCacheKey(playlistId))?.payload;
      if (cachedStats) {
        return res.json({ ok: true, stats: cachedStats, deduped: true });
      }
      // fall through to fetch stats without upsert
      const stats = await fetchPlaylistStats(playlistId);
      return res.json({ ok: true, stats, deduped: true });
    }

    // SQL-level dedupe guard per 10s bucket
    const bucket = new Date(Math.floor(now / TEN_SECONDS_MS) * TEN_SECONDS_MS).toISOString();
    const { error: dedupeError } = await supabase
      .from('view_dedupe')
      .insert({ view_type: 'playlist_public', user_id: internalUserId, playlist_id: playlistId, bucket_start: bucket });

    if (dedupeError && dedupeError.code !== '23505') {
      console.error('[registerPlaylistView] Dedupe insert failed', dedupeError);
      return res.status(500).json({ error: 'view_insert_failed' });
    }

    if (dedupeError && dedupeError.code === '23505') {
      console.info('[registerPlaylistView] view deduplicated', { user_id: internalUserId, playlist_id: playlistId, reason: 'sql_bucket' });
      const stats = await fetchPlaylistStats(playlistId);
      return res.json({ ok: true, stats, deduped: true });
    }

    console.info('[registerPlaylistView] view accepted', { user_id: internalUserId, playlist_id: playlistId, bucket });

    const { error: upsertError } = await supabase
      .from('playlist_views')
      .upsert(
        {
          playlist_id: playlistId,
          user_id: internalUserId,
          viewed_at: new Date().toISOString(),
        },
        {
          onConflict: 'playlist_id,user_id',
          ignoreDuplicates: true,
        }
      );

    if (upsertError) {
      throw upsertError;
    }

    viewDeduper.set(dedupeKey, now);

    const stats = await fetchPlaylistStats(playlistId);

    return res.json({ ok: true, stats });
  } catch (error) {
    console.error('[registerPlaylistView] Failed to register view', error);
    return res.status(500).json({ error: 'view_insert_failed' });
  }
}
