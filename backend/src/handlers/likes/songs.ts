import { Request, Response } from 'express';
import supabase from '../../services/supabaseClient';

function getUserId(req: Request): string | null {
  const user = (req as any).user as { id?: string } | undefined;
  return user?.id ?? null;
}

export async function getLikedSongs(req: Request, res: Response) {
  const userId = getUserId(req);
  if (!userId) {
    return res.status(401).json({ success: false, error: 'not_authenticated' });
  }

  const { data, error } = await supabase
    .from('likes')
    .select(`
      track_id,
      liked_at,
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
    .order('liked_at', { ascending: false });

  if (error) {
    return res.status(500).json({ success: false, error: error.message });
  }

  const seen = new Set<string>();
  const items = (data || [])
    .filter((row: any) => row.tracks)
    .map((row: any) => row.tracks as any)
    .filter((track: any) => {
      if (!track?.id) return false;
      if (seen.has(track.id)) return false;
      seen.add(track.id);
      return true;
    })
    .map((track: any) => ({
      id: String(track.id),
      title: track.title ?? '',
      artist: track.artist ?? null,
      cover_url: track.cover_url ?? null,
      external_id: track.external_id ?? null,
      duration: track.duration ?? null,
    }));

  return res.json({ success: true, items });
}

// POST /likes/songs/:trackId
export async function likeSong(req: Request, res: Response) {
  const userId = getUserId(req);
  if (!userId) {
    return res.status(401).json({ success: false, error: 'not_authenticated' });
  }

  const trackId = req.params.trackId as string | undefined;
  if (!trackId) {
    return res.status(400).json({ success: false, error: 'track_id_required' });
  }

  const { error } = await supabase
    .from('likes')
    .upsert(
      { user_id: userId, track_id: trackId, liked_at: new Date().toISOString() },
      { onConflict: 'user_id,track_id' }
    );

  if (error) {
    return res.status(500).json({ success: false, error: error.message });
  }

  return res.json({ success: true });
}

// DELETE /likes/songs/:trackId
export async function unlikeSong(req: Request, res: Response) {
  const userId = getUserId(req);
  if (!userId) {
    return res.status(401).json({ success: false, error: 'not_authenticated' });
  }

  const trackId = req.params.trackId as string | undefined;
  if (!trackId) {
    return res.status(400).json({ success: false, error: 'track_id_required' });
  }

  const { error } = await supabase
    .from('likes')
    .delete()
    .eq('user_id', userId)
    .eq('track_id', trackId);

  if (error) {
    return res.status(500).json({ success: false, error: error.message });
  }

  return res.json({ success: true });
}
