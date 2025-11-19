import { Request, Response } from 'express';
import supabase from '../../services/supabaseClient';

function getUserId(req: Request): string | null {
  const user = (req as any).user as { id?: string } | undefined;
  return user?.id ?? null;
}

export async function getLikedPlaylists(req: Request, res: Response) {
  const userId = getUserId(req);
  if (!userId) {
    return res.status(401).json({ success: false, error: 'not_authenticated' });
  }

  const { data, error } = await supabase
    .from('playlist_likes')
    .select(`
      playlist_id,
      liked_at,
      playlists (
        id,
        title,
        description,
        cover_url,
        region,
        category,
        owner_id,
        created_at
      )
    `)
    .eq('user_id', userId)
    .not('playlist_id', 'is', null)
    .order('liked_at', { ascending: false });

  if (error) {
    return res.status(500).json({ success: false, error: error.message });
  }

  const seen = new Set<string>();
  const items = (data || [])
    .filter((row: any) => row.playlists)
    .map((row: any) => row.playlists as any)
    .filter((pl: any) => {
      if (!pl?.id) return false;
      if (seen.has(pl.id)) return false;
      seen.add(pl.id);
      return true;
    })
    .map((pl: any) => ({
      id: String(pl.id),
      title: pl.title ?? '',
      description: pl.description ?? null,
      cover_url: pl.cover_url ?? null,
      region: pl.region ?? null,
      category: pl.category ?? null,
      owner_id: pl.owner_id ?? null,
      created_at: pl.created_at ?? null,
    }));

  return res.json({ success: true, items });
}

// POST /likes/playlists/:playlistId
export async function likePlaylist(req: Request, res: Response) {
  const userId = getUserId(req);
  if (!userId) {
    return res.status(401).json({ success: false, error: 'not_authenticated' });
  }

  const playlistId = req.params.playlistId as string | undefined;
  if (!playlistId) {
    return res.status(400).json({ success: false, error: 'playlist_id_required' });
  }

  const { error } = await supabase
    .from('playlist_likes')
    .upsert(
      { user_id: userId, playlist_id: playlistId, liked_at: new Date().toISOString() },
      { onConflict: 'user_id,playlist_id' }
    );

  if (error) {
    return res.status(500).json({ success: false, error: error.message });
  }

  return res.json({ success: true });
}

// DELETE /likes/playlists/:playlistId
export async function unlikePlaylist(req: Request, res: Response) {
  const userId = getUserId(req);
  if (!userId) {
    return res.status(401).json({ success: false, error: 'not_authenticated' });
  }

  const playlistId = req.params.playlistId as string | undefined;
  if (!playlistId) {
    return res.status(400).json({ success: false, error: 'playlist_id_required' });
  }

  const { error } = await supabase
    .from('playlist_likes')
    .delete()
    .eq('user_id', userId)
    .eq('playlist_id', playlistId);

  if (error) {
    return res.status(500).json({ success: false, error: error.message });
  }

  return res.json({ success: true });
}
