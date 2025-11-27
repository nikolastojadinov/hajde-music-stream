import { Router } from 'express';
import supabase from '../services/supabaseClient';

const router = Router();

/**
 * Track playlist view/click
 * POST /api/playlist-views/track
 * Body: { user_id: string, playlist_id: string }
 */
router.post('/track', async (req, res) => {
  try {
    const { user_id, playlist_id } = req.body;

    if (!user_id || !playlist_id) {
      return res.status(400).json({ error: 'user_id and playlist_id are required' });
    }

    // Check if record exists
    const { data: existing, error: fetchError } = await supabase!
      .from('playlist_views')
      .select('id, view_count')
      .eq('user_id', user_id)
      .eq('playlist_id', playlist_id)
      .single();

    if (fetchError && fetchError.code !== 'PGRST116') {
      // PGRST116 = no rows returned (expected for new records)
      throw fetchError;
    }

    if (existing) {
      // Increment view_count and update last_viewed_at
      const { error: updateError } = await supabase!
        .from('playlist_views')
        .update({
          view_count: existing.view_count + 1,
          last_viewed_at: new Date().toISOString(),
        })
        .eq('id', existing.id);

      if (updateError) throw updateError;

      return res.json({
        success: true,
        view_count: existing.view_count + 1,
        action: 'updated',
      });
    } else {
      // Create new record
      const { error: insertError } = await supabase!
        .from('playlist_views')
        .insert({
          user_id,
          playlist_id,
          view_count: 1,
          viewed_at: new Date().toISOString(),
          last_viewed_at: new Date().toISOString(),
        });

      if (insertError) throw insertError;

      return res.json({
        success: true,
        view_count: 1,
        action: 'created',
      });
    }
  } catch (error: any) {
    console.error('[playlistViews] Track error:', error);
    return res.status(500).json({
      error: 'Failed to track playlist view',
      details: error.message,
    });
  }
});

/**
 * Get top playlists for user
 * GET /api/playlist-views/top?user_id=xxx&limit=6
 */
router.get('/top', async (req, res) => {
  try {
    const { user_id, limit = '6' } = req.query;

    if (!user_id) {
      return res.status(400).json({ error: 'user_id is required' });
    }

    const { data: views, error: viewsError } = await supabase!
      .from('playlist_views')
      .select('playlist_id, view_count, last_viewed_at')
      .eq('user_id', user_id)
      .order('view_count', { ascending: false })
      .order('last_viewed_at', { ascending: false })
      .limit(parseInt(limit as string, 10));

    if (viewsError) throw viewsError;

    const playlistIds = Array.from(
      new Set((views || []).map((view) => view.playlist_id).filter(Boolean))
    ) as string[];

    let playlistMap = new Map<string, any>();

    if (playlistIds.length > 0) {
      const { data: playlistData, error: playlistError } = await supabase!
        .from('playlists')
        .select('id, title, cover_url, description')
        .in('id', playlistIds);

      if (playlistError) throw playlistError;

      playlistMap = new Map((playlistData || []).map((playlist) => [playlist.id, playlist]));
    }

    const merged = (views || []).map((view) => {
      const playlist = playlistMap.get(view.playlist_id) || null;
      return {
        ...view,
        playlist,
        playlists: playlist,
      };
    });

    return res.json({ playlists: merged });
  } catch (error: any) {
    console.error('[playlistViews] Get top error:', error);
    return res.status(500).json({
      error: 'Failed to fetch top playlists',
      details: error.message,
    });
  }
});

export default router;
