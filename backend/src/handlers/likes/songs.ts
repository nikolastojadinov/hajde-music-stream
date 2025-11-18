import { Request, Response } from 'express';
import supabase from '../../services/supabaseClient';

function resolveUserId(req: Request): string | null {
  const fromAuth = (req as any).currentUser?.uid || null;
  const fromQuery = typeof req.query.user_id === 'string' ? req.query.user_id : null;
  return fromAuth || fromQuery;
}

export async function getLikedSongs(req: Request, res: Response) {
  const userId = resolveUserId(req);
  if (!userId) return res.status(400).json({ success: false, error: 'user_id_required' });

  const { data, error } = await supabase
    .from('likes')
    .select(`
      track_id,
      created_at,
      tracks (
        id,
        title,
        artist,
        cover_url,
        external_id,
        duration
      )
    `)
    .eq('user_id', userId)
    .not('track_id', 'is', null)
    .order('created_at', { ascending: false });

  if (error) return res.status(500).json({ success: false, error: error.message });

  const seen = new Set<string>();
  const items = (data || [])
    .filter(r => r.tracks)
    .map(r => r.tracks as any)
    .filter(track => {
      if (seen.has(track.id)) return false;
      seen.add(track.id);
      return true;
    });

  return res.json({ success: true, items });
}

export async function likeSong(req: Request, res: Response) {
  const userId = resolveUserId(req);
  const trackId = String(req.params.id || '').trim();
  if (!userId || !trackId) {
    return res.status(400).json({ success: false, error: 'user_id_and_track_id_required' });
  }

  const { error } = await supabase
    .from('likes')
    .upsert({ user_id: userId, track_id: trackId }, { onConflict: 'user_id,track_id' });

  if (error) return res.status(500).json({ success: false, error: error.message });
  return res.json({ success: true });
}

export async function unlikeSong(req: Request, res: Response) {
  const userId = resolveUserId(req);
  const trackId = String(req.params.id || '').trim();
  if (!userId || !trackId) {
    return res.status(400).json({ success: false, error: 'user_id_and_track_id_required' });
  }

  const { error } = await supabase
    .from('likes')
    .delete()
    .eq('user_id', userId)
    .eq('track_id', trackId);

  if (error) return res.status(500).json({ success: false, error: error.message });
  return res.json({ success: true });
}
