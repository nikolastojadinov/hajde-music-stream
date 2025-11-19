import { Request, Response } from 'express';
import supabase from '../../services/supabaseClient';

export async function getUserLibrary(req: Request, res: Response) {
  const user = (req as any).user as { id?: string } | undefined;
  const userId = user?.id;
  if (!userId) {
    return res.status(401).json({ success: false, error: 'not_authenticated' });
  }

  // Liked songs
  const { data: songRows, error: songError } = await supabase
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

  if (songError) return res.status(500).json({ success: false, error: songError.message });

  const songSeen = new Set<string>();
  const likedSongs = (songRows || [])
    .filter(r => r.tracks)
    .map(r => r.tracks as any)
    .filter(track => {
      if (songSeen.has(track.id)) return false;
      songSeen.add(track.id);
      return true;
    });

  // Liked playlists
  const { data: playlistRows, error: playlistError } = await supabase
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

  if (playlistError) return res.status(500).json({ success: false, error: playlistError.message });

  const playlistSeen = new Set<string>();
  const likedPlaylists = (playlistRows || [])
    .filter(r => r.playlists)
    .map(r => r.playlists as any)
    .filter(pl => {
      if (playlistSeen.has(pl.id)) return false;
      playlistSeen.add(pl.id);
      return true;
    });

  return res.json({
    success: true,
    likedSongs,
    likedPlaylists
  });
}
