import { Request, Response } from 'express';
import { createClient } from '@supabase/supabase-js';

function getClient() {
  const url = process.env.EXTERNAL_SUPABASE_URL;
  const key = process.env.EXTERNAL_SUPABASE_SERVICE_ROLE;
  if (!url || !key) throw new Error('Missing EXTERNAL_SUPABASE_URL or EXTERNAL_SUPABASE_SERVICE_ROLE');
  return createClient(url, key, { auth: { persistSession: false } });
}

// POST /likes/playlists/:playlistId
export async function likePlaylist(req: Request, res: Response) {
  try {
    const user = (req as any).user as { id?: string } | undefined;
    const userId = user?.id;
    const playlistId = req.params.playlistId || req.params.id;
    if (!userId) return res.status(401).json({ success: false, error: 'not_authenticated' });
    if (!playlistId) return res.status(400).json({ success: false, error: 'missing_playlist_id' });

    const client = getClient();
    const { error } = await client
      .from('playlist_likes')
      .upsert(
        { user_id: userId, playlist_id: playlistId, created_at: new Date().toISOString() },
        { onConflict: 'user_id,playlist_id' }
      );

    if (error) return res.status(500).json({ success: false, error: error.message });
    return res.json({ success: true });
  } catch (e: any) {
    return res.status(500).json({ success: false, error: e.message || 'server_error' });
  }
}

// DELETE /likes/playlists/:playlistId
export async function unlikePlaylist(req: Request, res: Response) {
  try {
    const user = (req as any).user as { id?: string } | undefined;
    const userId = user?.id;
    const playlistId = req.params.playlistId || req.params.id;
    if (!userId) return res.status(401).json({ success: false, error: 'not_authenticated' });
    if (!playlistId) return res.status(400).json({ success: false, error: 'missing_playlist_id' });

    const client = getClient();
    const { error } = await client
      .from('playlist_likes')
      .delete()
      .eq('user_id', userId)
      .eq('playlist_id', playlistId);

    if (error) return res.status(500).json({ success: false, error: error.message });
    return res.json({ success: true });
  } catch (e: any) {
    return res.status(500).json({ success: false, error: e.message || 'server_error' });
  }
}
