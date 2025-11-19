import { Request, Response } from 'express';
import { createClient } from '@supabase/supabase-js';

function getClient() {
  const url = process.env.EXTERNAL_SUPABASE_URL;
  const key = process.env.EXTERNAL_SUPABASE_SERVICE_ROLE;
  if (!url || !key) throw new Error('Missing EXTERNAL_SUPABASE_URL or EXTERNAL_SUPABASE_SERVICE_ROLE');
  return createClient(url, key, { auth: { persistSession: false } });
}

export async function getLikedSongs(req: Request, res: Response) {
  try {
    const uid = req.currentUser?.uid;
    if (!uid) return res.status(401).json({ success: false, error: 'not_authenticated' });

    const client = getClient();

    const { data, error } = await client
      .from('likes')
      .select('track_id, liked_at')
      .eq('user_id', uid)
      .order('liked_at', { ascending: false });

    if (error) return res.status(500).json({ success: false, error: error.message });
    return res.json({ success: true, data });
  } catch (e: any) {
    return res.status(500).json({ success: false, error: e.message });
  }
}

export async function likeSong(req: Request, res: Response) {
  try {
    const uid = req.currentUser?.uid;
    const trackId = req.params.id;
    if (!uid || !trackId)
      return res.status(400).json({ success: false, error: 'missing_user_or_track_id' });

    const client = getClient();

    const { error } = await client
      .from('likes')
      .upsert(
        { user_id: uid, track_id: trackId, liked_at: new Date().toISOString() },
        { onConflict: 'user_id,track_id' }
      );

    if (error) return res.status(500).json({ success: false, error: error.message });
    return res.json({ success: true });
  } catch (e: any) {
    return res.status(500).json({ success: false, error: e.message });
  }
}

export async function unlikeSong(req: Request, res: Response) {
  try {
    const uid = req.currentUser?.uid;
    const trackId = req.params.id;
    if (!uid || !trackId)
      return res.status(400).json({ success: false, error: 'missing_user_or_track_id' });

    const client = getClient();

    const { error } = await client
      .from('likes')
      .delete()
      .eq('user_id', uid)
      .eq('track_id', trackId);

    if (error) return res.status(500).json({ success: false, error: error.message });
    return res.json({ success: true });
  } catch (e: any) {
    return res.status(500).json({ success: false, error: e.message });
  }
}
