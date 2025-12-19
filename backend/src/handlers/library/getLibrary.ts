import { Request, Response } from 'express';
import supabase from '../../services/supabaseClient';

type AuthedRequest = Request & {
  user?: {
    id?: string;
  };
};

type LikeRow = {
  track_id: string | null;
  liked_at: string | null;
};

type PlaylistLikeRow = {
  playlist_id: string | null;
  liked_at: string | null;
};

type TrackRow = {
  id: string | number;
  title?: string | null;
  artist?: string | null;
  cover_url?: string | null;
  external_id?: string | null;
  duration?: number | null;
};

type PlaylistRow = {
  id: string | number;
  title?: string | null;
  description?: string | null;
  cover_url?: string | null;
  region?: string | null;
  category?: string | null;
  owner_id?: string | null;
  created_at?: string | null;
};

type LibrarySong = {
  id: string;
  title: string;
  artist: string | null;
  cover_url: string | null;
  external_id: string | null;
  duration: number | null;
};

type LibraryPlaylist = {
  id: string;
  title: string;
  description: string | null;
  cover_url: string | null;
  region: string | null;
  category: string | null;
  owner_id: string | null;
  created_at: string | null;
};

export async function getUserLibrary(req: AuthedRequest, res: Response) {
  try {
    const user = req.user;
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

    // Fetch liked songs and playlists in parallel to reduce total latency
    const [likeResult, playlistLikeResult] = await Promise.all([
      supabase
        .from('likes')
        .select('track_id, liked_at')
        .in('user_id', userIds)
        .not('track_id', 'is', null)
        .order('liked_at', { ascending: false })
        .returns<LikeRow[]>(),
      supabase
        .from('playlist_likes')
        .select('playlist_id, liked_at')
        .in('user_id', userIds)
        .not('playlist_id', 'is', null)
        .order('liked_at', { ascending: false })
        .returns<PlaylistLikeRow[]>(),
    ]);

    const likeRows = likeResult.data ?? [];
    const likeErr = likeResult.error;
    if (likeErr) {
      console.error('[LIBRARY ERROR - SONGS]', likeErr);
      return res.status(500).json({ success: false, error: likeErr.message });
    }

    const plRows = playlistLikeResult.data ?? [];
    const plErr = playlistLikeResult.error;
    if (plErr) {
      console.error('[LIBRARY ERROR - PLAYLIST LIKES]', plErr);
      return res.status(500).json({ success: false, error: plErr.message });
    }

    const trackIds = Array.from(
      new Set((likeRows || []).map(r => r.track_id).filter(Boolean))
    );

    let likedSongs: LibrarySong[] = [];

    if (trackIds.length > 0) {
      const { data: trackRows, error: trackErr } = await supabase
        .from('tracks')
        .select('id, title, artist, cover_url, external_id, duration')
        .in('id', trackIds)
        .returns<TrackRow[]>();

      if (trackErr) {
        console.error('[LIBRARY ERROR - SONG TRACKS]', trackErr);
        return res.status(500).json({ success: false, error: trackErr.message });
      }

      const map = new Map(trackRows?.map(t => [String(t.id), t]));
      const seen = new Set<string>();

      likedSongs = likeRows.reduce<LibrarySong[]>((acc, row) => {
        const id = row.track_id;
        if (!id || seen.has(id)) return acc;

        const track = map.get(String(id));
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

    const playlistIds = Array.from(
      new Set((plRows || []).map(r => r.playlist_id).filter(Boolean))
    );

    let likedPlaylists: LibraryPlaylist[] = [];

    if (playlistIds.length > 0) {
      const { data: playlistRows, error: playlistErr } = await supabase
        .from('playlists')
        .select('id, title, description, cover_url, region, category, owner_id, created_at, external_id')
        .in('id', playlistIds)
        .returns<PlaylistRow[]>();

      if (playlistErr) {
        console.error('[LIBRARY ERROR - PLAYLISTS]', playlistErr);
        return res.status(500).json({ success: false, error: playlistErr.message });
      }

      const map = new Map(playlistRows?.map(p => [String(p.id), p]));
      const seen = new Set<string>();

      likedPlaylists = plRows.reduce<LibraryPlaylist[]>((acc, row) => {
        const id = row.playlist_id;
        if (!id || seen.has(id)) return acc;

        const pl = map.get(String(id));
        if (!pl) return acc;

        const externalId = typeof (pl as any)?.external_id === 'string' ? String((pl as any).external_id).trim() : '';
        if (externalId.startsWith('OLAK')) return acc;

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

  } catch (err) {
    console.error('[LIBRARY ERROR - CATCH]', err);
    const message = err instanceof Error ? err.message : 'unknown_error';
    return res.status(500).json({ success: false, error: message });
  }
}
