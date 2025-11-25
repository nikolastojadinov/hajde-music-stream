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

  const viewerId = getRequestUserId(req);

  if (!viewerId) {
    return res.status(401).json({ error: 'user_not_authenticated' });
  }

  if (!supabase) {
    return res.status(500).json({ error: 'supabase_not_initialized' });
  }

  try {
    const { data: existing, error: existingError } = await supabase
      .from('playlist_views')
      .select('id')
      .eq('playlist_id', playlistId)
      .eq('user_id', viewerId)
      .maybeSingle();

    if (existingError && existingError.code !== 'PGRST116') {
      throw existingError;
    }

    if (existing) {
      return res.json({ ok: true, already_tracked: true });
    }

    const { error } = await supabase.from('playlist_views').insert({
      playlist_id: playlistId,
      user_id: viewerId,
    });

    if (error) {
      throw error;
    }

    return res.json({ ok: true });
  } catch (error) {
    console.error('[registerPlaylistView] Failed to register view', error);
    return res.status(500).json({ error: 'view_insert_failed' });
  }
}
