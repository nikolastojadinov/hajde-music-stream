import { Request, Response } from 'express';
import supabase from '../../services/supabaseClient';

// Rewritten to avoid nested foreign key selects that were causing 500 errors.
// Implements a two-step approach: first fetch like rows (track/playlist IDs + liked_at),
// then fetch the referenced entities. Preserves liked_at ordering and deduplicates by ID.
export async function getUserLibrary(req: Request, res: Response) {
  try {
    const user = (req as any).user as { id?: string } | undefined;
    const userId = user?.id;
    if (!userId) {
      return res.status(401).json({ success: false, error: 'not_authenticated' });
    }

    if (!supabase) {
      return res.status(500).json({ success: false, error: 'supabase_not_initialized' });
    }

    // ---------------------------------
    // 1) Fetch liked song track IDs
    // ---------------------------------
    const { data: likeRows, error: likeErr } = await supabase
      .from('likes')
      .select('track_id, liked_at')
      .eq('user_id', userId)
      .not('track_id', 'is', null)
      .order('liked_at', { ascending: false });

    if (likeErr) {
      return res.status(500).json({ success: false, error: likeErr.message });
    }

    const trackIds = Array.from(
      new Set(
        (likeRows || [])
          .map(r => r.track_id as string | null)
          .filter((id): id is string => !!id)
      )
    );

    let likedSongs: any[] = [];
    if (trackIds.length > 0) {
      const { data: trackRows, error: trackErr } = await supabase
        .from('tracks')
        .select('id, title, artist, cover_url, external_id, duration')
        .in('id', trackIds);

      if (trackErr) {
        return res.status(500).json({ success: false, error: trackErr.message });
      }

      const map = new Map(trackRows.map(t => [t.id, t]));
      const seen = new Set<string>();
      likedSongs = (likeRows || []).reduce((acc: any[], row: any) => {
        const id = row.track_id;
        if (!id || seen.has(id)) return acc;
        const t = map.get(id);
        if (!t) return acc;
        seen.add(id);
        acc.push({
          id: String(t.id),
          title: t.title ?? '',
          artist: t.artist ?? null,
          cover_url: t.cover_url ?? null,
          external_id: t.external_id ?? null,
          duration: t.duration ?? null,
        });
        return acc;
      }, []);
    }

    // ---------------------------------
    // 2) Fetch liked playlist IDs
    // ---------------------------------
    const { data: plLikeRows, error: plLikeErr } = await supabase
      .from('playlist_likes')
      .select('playlist_id, liked_at')
      .eq('user_id', userId)
      .not('playlist_id', 'is', null)
      .order('liked_at', { ascending: false });

    if (plLikeErr) {
      return res.status(500).json({ success: false, error: plLikeErr.message });
    }

    const playlistIds = Array.from(
      new Set(
        (plLikeRows || [])
          .map(r => r.playlist_id as string | null)
          .filter((id): id is string => !!id)
      )
    );

    let likedPlaylists: any[] = [];
    if (playlistIds.length > 0) {
      const { data: playlistRows, error: playlistErr } = await supabase
        .from('playlists')
        .select('id, title, description, cover_url, region, category, owner_id, created_at')
        .in('id', playlistIds);

      if (playlistErr) {
        return res.status(500).json({ success: false, error: playlistErr.message });
      }

      const map = new Map(playlistRows.map(p => [p.id, p]));
      const seen = new Set<string>();
      likedPlaylists = (plLikeRows || []).reduce((acc: any[], row: any) => {
        const id = row.playlist_id;
        if (!id || seen.has(id)) return acc;
        const p = map.get(id);
        if (!p) return acc;
        seen.add(id);
        acc.push({
          id: String(p.id),
          title: p.title ?? '',
          description: p.description ?? null,
          cover_url: p.cover_url ?? null,
          region: p.region ?? null,
          category: p.category ?? null,
          owner_id: p.owner_id ?? null,
          created_at: p.created_at ?? null,
        });
        return acc;
      }, []);
    }

    return res.json({
      success: true,
      likedSongs,
      likedPlaylists,
    });
  } catch (e: any) {
    return res.status(500).json({ success: false, error: e?.message || 'unknown_error' });
  }
}
