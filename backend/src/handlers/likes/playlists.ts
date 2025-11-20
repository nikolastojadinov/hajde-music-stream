import { Request, Response } from 'express';
import supabase from '../../services/supabaseClient';

// PiAuth nam daje wallet (pi user id) u user.id; treba da ga mapiramo na users.id (UUID) za playlist_likes FK.
async function mapWalletToInternalId(wallet: string): Promise<string | null> {
  if (!wallet) return null;
  const { data, error } = await supabase
    .from('users')
    .select('id')
    .eq('wallet', wallet)
    .limit(1)
    .maybeSingle();
  if (error) {
    console.error('[playlist_likes] users lookup error', error.message);
    return null;
  }
  return data?.id || null;
}

function getWallet(req: Request): string | null {
  const user = (req as any).user as { id?: string } | undefined;
  return user?.id ?? null; // Ovo je Pi wallet/uid, NE internal users.id
}

export async function getLikedPlaylists(req: Request, res: Response) {
  const wallet = getWallet(req);
  if (!wallet) return res.status(401).json({ success: false, error: 'not_authenticated' });
  const internalId = await mapWalletToInternalId(wallet);
  if (!internalId) return res.status(500).json({ success: false, error: 'user_internal_id_missing' });

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
    .eq('user_id', internalId)
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
  const wallet = getWallet(req);
  if (!wallet) return res.status(401).json({ success: false, error: 'not_authenticated' });
  const internalId = await mapWalletToInternalId(wallet);
  if (!internalId) return res.status(500).json({ success: false, error: 'user_internal_id_missing' });

  const playlistId = req.params.playlistId as string | undefined;
  if (!playlistId) {
    return res.status(400).json({ success: false, error: 'playlist_id_required' });
  }

  const { error } = await supabase
    .from('playlist_likes')
    .upsert(
      { user_id: internalId, playlist_id: playlistId, liked_at: new Date().toISOString() },
      { onConflict: 'user_id,playlist_id' }
    );

  if (error) {
    return res.status(500).json({ success: false, error: error.message });
  }

  return res.json({ success: true });
}

// DELETE /likes/playlists/:playlistId
export async function unlikePlaylist(req: Request, res: Response) {
  const wallet = getWallet(req);
  if (!wallet) return res.status(401).json({ success: false, error: 'not_authenticated' });
  const internalId = await mapWalletToInternalId(wallet);
  if (!internalId) return res.status(500).json({ success: false, error: 'user_internal_id_missing' });

  const playlistId = req.params.playlistId as string | undefined;
  if (!playlistId) {
    return res.status(400).json({ success: false, error: 'playlist_id_required' });
  }

  const { error } = await supabase
    .from('playlist_likes')
    .delete()
    .eq('user_id', internalId)
    .eq('playlist_id', playlistId);

  if (error) {
    return res.status(500).json({ success: false, error: error.message });
  }

  return res.json({ success: true });
}
