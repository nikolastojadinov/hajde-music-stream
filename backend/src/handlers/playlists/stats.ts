import { Request, Response } from 'express';
import supabase from '../../services/supabaseClient';

interface PublicStatsResponse {
  likes: number;
  views: number;
}

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
  const { data, error } = await supabase!
    .from('playlist_stats')
    .select('public_like_count, public_view_count')
    .eq('playlist_id', playlistId)
    .maybeSingle();

  if (error && error.code !== 'PGRST116') {
    throw error;
  }

  return {
    likes: data?.public_like_count ?? 0,
    views: data?.public_view_count ?? 0,
  };
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

    const stats = await fetchPlaylistStats(playlistId);

    return res.json({ ok: true, stats });
  } catch (error) {
    console.error('[registerPlaylistView] Failed to register view', error);
    return res.status(500).json({ error: 'view_insert_failed' });
  }
}
