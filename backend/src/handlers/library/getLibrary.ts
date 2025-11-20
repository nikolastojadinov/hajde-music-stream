import { Request, Response } from 'express';
import supabase from '../../services/supabaseClient';

export async function getUserLibrary(req: Request, res: Response) {
  try {
    const user = (req as any).user;
    const wallet = user?.id; // Pi wallet / external UID

    if (!wallet) {
      return res.status(401).json({ success: false, error: 'not_authenticated' });
    }

    if (!supabase) {
      return res.status(500).json({ success: false, error: 'supabase_not_initialized' });
    }

    // Map wallet → internal users.id (UUID) for tables that FK na users.id (playlist_likes). Likes tabela takođe koristi UUID user_id.
    const { data: userRow, error: userLookupError } = await supabase
      .from('users')
      .select('id')
      .eq('wallet', wallet)
      .limit(1)
      .maybeSingle();

    if (userLookupError) {
      console.error('[LIBRARY ERROR - USER LOOKUP]', userLookupError);
      return res.status(500).json({ success: false, error: 'user_lookup_failed' });
    }
    const internalUserId = userRow?.id;
    if (!internalUserId) {
      console.error('[LIBRARY ERROR - INTERNAL USER ID MISSING]', { wallet });
      return res.status(500).json({ success: false, error: 'internal_user_id_missing' });
    }

    const userIds = [internalUserId];
    if (wallet && wallet !== internalUserId) {
      userIds.push(wallet);
    }

    // ------------------------------------------------------------------
    // 1) FETCH LIKED SONGS (track_id) → THEN FETCH TRACK ENTITIES
    // ------------------------------------------------------------------
    const { data: likeRows, error: likeErr } = await supabase
      .from('likes')
      .select('track_id, liked_at')
      .in('user_id', userIds)
      .not('track_id', 'is', null)
      .order('liked_at', { ascending: false });

    if (likeErr) {
      console.error('[LIBRARY ERROR - SONGS]', likeErr);
      return res.status(500).json({ success: false, error: likeErr.message });
    }

    const trackIds = Array.from(
      new Set((likeRows || []).map(r => r.track_id).filter(Boolean))
    );

    let likedSongs: any[] = [];

    if (trackIds.length > 0) {
      const { data: trackRows, error: trackErr } = await supabase
        .from('tracks')
        .select('id, title, artist, cover_url, external_id, duration')
        .in('id', trackIds);

      if (trackErr) {
        console.error('[LIBRARY ERROR - SONG TRACKS]', trackErr);
        return res.status(500).json({ success: false, error: trackErr.message });
      }

      const map = new Map(trackRows.map(t => [t.id, t]));
      const seen = new Set();

      likedSongs = likeRows.reduce((acc: any[], row: any) => {
        const id = row.track_id;
        if (!id || seen.has(id)) return acc;

        const track = map.get(id);
        if (!track) return acc;

        seen.add(id);
        acc.push({
          id: String(track.id),
          title: track.title ?? '',
          artist: track.artist ?? null,
          cover_url: track.cover_url ?? null,
          external_id: track.external_id ?? null,
          duration: track.duration ?? null,
        });

        return acc;
      }, []);
    }

    // ------------------------------------------------------------------
    // 2) FETCH LIKED PLAYLISTS (playlist_id) → THEN FETCH PLAYLIST ENTITIES
    // ------------------------------------------------------------------
    const { data: plRows, error: plErr } = await supabase
      .from('playlist_likes')
      .select('playlist_id, liked_at')
      .in('user_id', userIds)
      .not('playlist_id', 'is', null)
      .order('liked_at', { ascending: false });

    if (plErr) {
      console.error('[LIBRARY ERROR - PLAYLIST LIKES]', plErr);
      return res.status(500).json({ success: false, error: plErr.message });
    }

    const playlistIds = Array.from(
      new Set((plRows || []).map(r => r.playlist_id).filter(Boolean))
    );

    let likedPlaylists: any[] = [];

    if (playlistIds.length > 0) {
      const { data: playlistRows, error: playlistErr } = await supabase
        .from('playlists')
        .select('id, title, description, cover_url, region, category, owner_id, created_at')
        .in('id', playlistIds);

      if (playlistErr) {
        console.error('[LIBRARY ERROR - PLAYLISTS]', playlistErr);
        return res.status(500).json({ success: false, error: playlistErr.message });
      }

      const map = new Map(playlistRows.map(p => [p.id, p]));
      const seen = new Set();

      likedPlaylists = plRows.reduce((acc: any[], row: any) => {
        const id = row.playlist_id;
        if (!id || seen.has(id)) return acc;

        const pl = map.get(id);
        if (!pl) return acc;

        seen.add(id);
        acc.push({
          id: String(pl.id),
          title: pl.title ?? '',
          description: pl.description ?? null,
          cover_url: pl.cover_url ?? null,
          region: pl.region ?? null,
          category: pl.category ?? null,
          owner_id: pl.owner_id ?? null,
          created_at: pl.created_at ?? null,
        });

        return acc;
      }, []);
    }

    // ------------------------------------------------------------------
    // FINAL RESPONSE
    // ------------------------------------------------------------------
    return res.json({
      success: true,
      likedSongs,
      likedPlaylists,
    });

  } catch (err: any) {
    console.error('[LIBRARY ERROR - CATCH]', err);
    return res.status(500).json({ success: false, error: err?.message || 'unknown_error' });
  }
}
