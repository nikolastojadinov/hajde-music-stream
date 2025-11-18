import { Request, Response } from 'express';
import supabase from '../../services/supabaseClient';

function resolveUserId(req: Request): string | null {
  const fromAuth = (req as any).currentUser?.uid || null;
  const fromQuery = typeof req.query.user_id === 'string' ? req.query.user_id : null;
  return fromAuth || fromQuery;
}

export async function getLikedPlaylists(req: Request, res: Response) {
  const userId = resolveUserId(req);
  if (!userId) return res.status(400).json({ success: false, error: 'user_id_required' });

  const { data, error } = await supabase
    .from('playlist_likes')
    .select(`
      playlist_id,
      created_at,
      playlists (
        id,
        title,
        description,
        cover_url,
        owner_id
      )
    `)
    .eq('user_id', userId)
    .not('playlist_id', 'is', null)
    .order('created_at', { ascending: false });

  if (error) return res.status(500).json({ success: false, error: error.message });

  const seen = new Set<string>();
  const items = (data || [])
    .filter(r => r.playlists)
    .map(r => r.playlists as any)
    .filter(pl => {
      if (seen.has(pl.id)) return false;
      seen.add(pl.id);
      return true;
    });

  return res.json({ success: true, items });
}

export async function likePlaylist(req: Request, res: Response) {
  const userId = resolveUserId(req);
  const playlistId = String(req.params.id || '').trim();
  if (!userId || !playlistId) {
    return res.status(400).json({ success: false, error: 'user_id_and_playlist_id_required' });
  }

  const { error } = await supabase
    .from('playlist_likes')
    .upsert({ user_id: userId, playlist_id: playlistId }, { onConflict: 'user_id,playlist_id' });

  if (error) return res.status(500).json({ success: false, error: error.message });
  return res.json({ success: true });
}

export async function unlikePlaylist(req: Request, res: Response) {
  const userId = resolveUserId(req);
  const playlistId = String(req.params.id || '').trim();
  if (!userId || !playlistId) {
    return res.status(400).json({ success: false, error: 'user_id_and_playlist_id_required' });
  }

  const { error } = await supabase
    .from('playlist_likes')
    .delete()
    .eq('user_id', userId)
    .eq('playlist_id', playlistId);

  if (error) return res.status(500).json({ success: false, error: error.message });
  return res.json({ success: true });
}
