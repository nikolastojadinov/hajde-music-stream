import { Request, Response } from 'express';
import supabase from '../../services/supabaseClient';

async function mapWalletToInternalId(wallet: string): Promise<string | null> {
  if (!wallet) return null;
  const { data, error } = await supabase
    .from('users')
    .select('id')
    .eq('wallet', wallet)
    .limit(1)
    .maybeSingle();

  if (error) {
    console.error('[likes:songs] users lookup error', error.message);
    return null;
  }

  return data?.id || null;
}

function getWallet(req: Request): string | null {
  const user = (req as any).user as { id?: string } | undefined;
  return user?.id ?? null; // Pi wallet UID
}

export async function getLikedSongs(req: Request, res: Response) {
  const wallet = getWallet(req);
  if (!wallet) {
    return res.status(401).json({ success: false, error: 'not_authenticated' });
  }

  const internalId = await mapWalletToInternalId(wallet);
  if (!internalId) {
    return res.status(500).json({ success: false, error: 'user_internal_id_missing' });
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
    .eq('user_id', internalId)
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
  const wallet = getWallet(req);
  if (!wallet) {
    return res.status(401).json({ success: false, error: 'not_authenticated' });
  }

  const internalId = await mapWalletToInternalId(wallet);
  if (!internalId) {
    return res.status(500).json({ success: false, error: 'user_internal_id_missing' });
  }

  const trackId = req.params.trackId as string | undefined;
  if (!trackId) {
    return res.status(400).json({ success: false, error: 'track_id_required' });
  }

  const { error } = await supabase
    .from('likes')
    .upsert(
      { user_id: internalId, track_id: trackId, liked_at: new Date().toISOString() },
      { onConflict: 'user_id,track_id' }
    );

  if (error) {
    return res.status(500).json({ success: false, error: error.message });
  }

  return res.json({ success: true });
}

// DELETE /likes/songs/:trackId
export async function unlikeSong(req: Request, res: Response) {
  const wallet = getWallet(req);
  if (!wallet) {
    return res.status(401).json({ success: false, error: 'not_authenticated' });
  }

  const internalId = await mapWalletToInternalId(wallet);
  if (!internalId) {
    return res.status(500).json({ success: false, error: 'user_internal_id_missing' });
  }

  const trackId = req.params.trackId as string | undefined;
  if (!trackId) {
    return res.status(400).json({ success: false, error: 'track_id_required' });
  }

  const { error } = await supabase
    .from('likes')
    .delete()
    .eq('user_id', internalId)
    .eq('track_id', trackId);

  if (error) {
    return res.status(500).json({ success: false, error: error.message });
  }

  return res.json({ success: true });
}
