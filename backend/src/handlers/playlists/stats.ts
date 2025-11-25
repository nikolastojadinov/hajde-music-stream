import { Request, Response } from 'express';
import supabase from '../../services/supabaseClient';

interface StatsResponse {
  likes: number;
  views: number;
  liked: boolean;
}

async function getPlaylistLikesCount(playlistId: string): Promise<number> {
  const { count, error } = await supabase!
    .from('playlist_likes')
    .select('*', { count: 'exact', head: true })
    .eq('playlist_id', playlistId);

  if (error) {
    throw error;
  }

  return count ?? 0;
}

async function getPlaylistViewsCount(playlistId: string): Promise<number> {
  const { count, error } = await supabase!
    .from('playlist_views')
    .select('*', { count: 'exact', head: true })
    .eq('playlist_id', playlistId);

  if (error) {
    throw error;
  }

  return count ?? 0;
}

async function mapCurrentUserToInternalId(req: Request): Promise<string | null> {
  const currentUser = (req as any).currentUser as { uid?: string } | undefined;
  const wallet = currentUser?.uid;
  if (!wallet) {
    return null;
  }

  const { data, error } = await supabase!
    .from('users')
    .select('id')
    .eq('wallet', wallet)
    .limit(1)
    .maybeSingle();

  if (error) {
    console.error('[getPlaylistStats] Failed to map current user to internal ID', error);
    return null;
  }

  return data?.id ?? null;
}

export async function getPlaylistStats(req: Request, res: Response) {
  const playlistId = req.params.id;

  if (!playlistId) {
    return res.status(400).json({ error: 'playlist_id_required' });
  }

  if (!supabase) {
    return res.status(500).json({ error: 'supabase_not_initialized' });
  }

  try {
    const [likes, views] = await Promise.all([
      getPlaylistLikesCount(playlistId),
      getPlaylistViewsCount(playlistId),
    ]);

    let liked = false;
    const internalUserId = await mapCurrentUserToInternalId(req);

    if (internalUserId) {
      const { count, error } = await supabase!
        .from('playlist_likes')
        .select('*', { count: 'exact', head: true })
        .eq('playlist_id', playlistId)
        .eq('user_id', internalUserId);

      if (error) {
        throw error;
      }

      liked = (count ?? 0) > 0;
    }

    const body: StatsResponse = {
      likes,
      views,
      liked,
    };

    return res.json(body);
  } catch (error) {
    console.error('[getPlaylistStats] Failed to fetch stats', error);
    return res.status(500).json({ error: 'stats_query_failed' });
  }
}

export async function registerPlaylistView(req: Request, res: Response) {
  const playlistId = req.params.id;

  if (!playlistId) {
    return res.status(400).json({ error: 'playlist_id_required' });
  }

  if (!supabase) {
    return res.status(500).json({ error: 'supabase_not_initialized' });
  }

  try {
    const { error } = await supabase.from('playlist_views').insert({ playlist_id: playlistId });

    if (error) {
      throw error;
    }

    return res.json({ ok: true });
  } catch (error) {
    console.error('[registerPlaylistView] Failed to register view', error);
    return res.status(500).json({ error: 'view_insert_failed' });
  }
}
