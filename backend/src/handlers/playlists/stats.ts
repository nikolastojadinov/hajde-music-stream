import { Request, Response } from 'express';
import supabase from '../../services/supabaseClient';

interface PublicStatsResponse {
  global_likes: number;
  global_clicks: number;
}

async function countRows(table: string, column: string, value: string): Promise<number> {
  const { count, error } = await supabase!
    .from(table)
    .select('*', { count: 'exact', head: true })
    .eq(column, value);

  if (error) {
    throw error;
  }

  return count ?? 0;
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
    const [globalLikes, globalClicks] = await Promise.all([
      countRows('playlist_likes', 'playlist_id', playlistId),
      countRows('playlist_views', 'playlist_id', playlistId),
    ]);

    const payload: PublicStatsResponse = {
      global_likes: globalLikes,
      global_clicks: globalClicks,
    };

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
