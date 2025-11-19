import { Request, Response } from 'express';
import { createClient } from '@supabase/supabase-js';

function getClient() {
  const url = process.env.EXTERNAL_SUPABASE_URL;
  const key = process.env.EXTERNAL_SUPABASE_SERVICE_ROLE;
  if (!url || !key) throw new Error('Missing EXTERNAL_SUPABASE_URL or EXTERNAL_SUPABASE_SERVICE_ROLE');
  return createClient(url, key, { auth: { persistSession: false } });
}

export async function getLikedPlaylists(req: Request, res: Response) {
  try {
    const uid = req.currentUser?.uid;
    if (!uid) return res.status(401).json({ success: false, error: 'not_authenticated' });

    const client = getClient();

    const { data, error } = await client
      .from('playlist_likes')
      .select('playlist_id, liked_at')
      .eq('user_id', uid)
      .order('liked_at', { ascending: false });

    if (error) return res.status(500).json({ success: false, error: error.message });
    return res.json({ success: true, data });
  } catch (e: any) {
    return res.status(500).json({ success: false, error: e.message });
  }
}

export async function likePlaylist(req: Request, res: Response) {
  try {
    const uid = req.currentUser?.uid;
    const playlistId = req.params.id;
    if (!uid || !playlistId)
      return res.status(400).json({ success: false, error: 'missing_user_or_playlist_id' });

    const client = getClient();

    const { error } = await client
      .from('playlist_likes')
      .upsert(
        { user_id: uid, playlist_id: playlistId, liked_at: new Date().toISOString() },
        { onConflict: 'user_id,playlist_id' }
      );

    if (error) return res.status(500).json({ success: false, error: error.message });
    return res.json({ success: true });
  } catch (e: any) {
    return res.status(500).json({ success: false, error: e.message });
  }
}

export async function unlikePlaylist(req: Request, res: Response) {
  try {
    const uid = req.currentUser?.uid;
    const playlistId = req.params.id;
    if (!uid || !playlistId)
      return res.status(400).json({ success: false, error: 'missing_user_or_playlist_id' });

    const client = getClient();

    const { error } = await client
      .from('playlist_likes')
      .delete()
      .eq('user_id', uid)
      .eq('playlist_id', playlistId);

    if (error) return res.status(500).json({ success: false, error: error.message });
    return res.json({ success: true });
  } catch (e: any) {
    return res.status(500).json({ success: false, error: e.message });
  }
}
