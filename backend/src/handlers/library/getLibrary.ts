import { Request, Response } from 'express';
import supabase from '../../services/supabaseClient';

export async function getUserLibrary(req: Request, res: Response) {
  const user = (req as any).user as { id?: string } | undefined;
  const userId = user?.id;
  if (!userId) {
    return res.status(401).json({ success: false, error: 'not_authenticated' });
  }

  const { data: songRows, error: songError } = await supabase
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

  if (songError) {
    return res.status(500).json({ success: false, error: songError.message });
  }

  const seenTracks = new Set<string>();
  const likedSongs = (songRows || [])
    .filter((row: any) => row.tracks)
    .map((row: any) => row.tracks as any)
    .filter((track: any) => {
      if (!track?.id) return false;
      if (seenTracks.has(track.id)) return false;
      seenTracks.add(track.id);
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

  const { data: playlistRows, error: playlistError } = await supabase
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

  if (playlistError) {
    return res.status(500).json({ success: false, error: playlistError.message });
  }

  const seenPlaylists = new Set<string>();
  const likedPlaylists = (playlistRows || [])
    .filter((row: any) => row.playlists)
    .map((row: any) => row.playlists as any)
    .filter((pl: any) => {
      if (!pl?.id) return false;
      if (seenPlaylists.has(pl.id)) return false;
      seenPlaylists.add(pl.id);
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

  return res.json({
    success: true,
    likedSongs,
    likedPlaylists,
  });
}
