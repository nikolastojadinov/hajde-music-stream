import { Router, Request, Response } from 'express';
import { getExternalSupabase } from '../services/externalSupabaseClient';

export default function mountLikesEndpoints(router: Router) {
  // GET /likes/tracks?user_id=...
  router.get('/tracks', async (req: Request, res: Response) => {
    try {
      const userId = String(req.query.user_id || '').trim();
      if (!userId) return res.status(400).json({ error: 'user_id required' });

      const supa = getExternalSupabase();
      const { data, error } = await supa
        .from('likes')
        .select(`
          track_id,
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
        .not('track_id', 'is', null);

      if (error) return res.status(500).json({ error: error.message });

      const items = (data || [])
        .filter((row: any) => row.tracks)
        .map((row: any) => row.tracks);
      return res.json({ items });
    } catch (e: any) {
      return res.status(500).json({ error: e.message || 'server_error' });
    }
  });

  // GET /likes/playlists?user_id=...
  router.get('/playlists', async (req: Request, res: Response) => {
    try {
      const userId = String(req.query.user_id || '').trim();
      if (!userId) return res.status(400).json({ error: 'user_id required' });

      const supa = getExternalSupabase();
      const { data, error } = await supa
        .from('likes')
        .select(`
          playlist_id,
          playlists (
            id,
            title,
            description,
            cover_url,
            category,
            created_at,
            owner_id
          )
        `)
        .eq('user_id', userId)
        .not('playlist_id', 'is', null);

      if (error) return res.status(500).json({ error: error.message });

      const items = (data || [])
        .filter((row: any) => row.playlists)
        .map((row: any) => row.playlists);
      return res.json({ items });
    } catch (e: any) {
      return res.status(500).json({ error: e.message || 'server_error' });
    }
  });

  // POST /likes/track/:trackId  body: { user_id }
  router.post('/track/:trackId', async (req: Request, res: Response) => {
    try {
      const trackId = String(req.params.trackId || '').trim();
      const userId = String(req.body?.user_id || '').trim();
      if (!trackId || !userId) return res.status(400).json({ error: 'user_id and trackId required' });

      const supa = getExternalSupabase();
      const { error } = await supa
        .from('likes')
        .upsert({ user_id: userId, track_id: trackId }, { onConflict: 'user_id,track_id' });

      if (error) return res.status(500).json({ error: error.message });
      return res.json({ ok: true });
    } catch (e: any) {
      return res.status(500).json({ error: e.message || 'server_error' });
    }
  });

  // DELETE /likes/track/:trackId  body: { user_id }
  router.delete('/track/:trackId', async (req: Request, res: Response) => {
    try {
      const trackId = String(req.params.trackId || '').trim();
      const userId = String(req.body?.user_id || '').trim();
      if (!trackId || !userId) return res.status(400).json({ error: 'user_id and trackId required' });

      const supa = getExternalSupabase();
      const { error } = await supa
        .from('likes')
        .delete()
        .eq('user_id', userId)
        .eq('track_id', trackId);

      if (error) return res.status(500).json({ error: error.message });
      return res.json({ ok: true });
    } catch (e: any) {
      return res.status(500).json({ error: e.message || 'server_error' });
    }
  });

  // Playlist-like írás a jelenlegi sémával nem támogatott (track_id NOT NULL + PK), ezért 400
  router.post('/playlist/:playlistId', async (_req: Request, res: Response) => {
    return res.status(400).json({ error: 'playlist_like_not_supported_by_current_schema' });
  });
  router.delete('/playlist/:playlistId', async (_req: Request, res: Response) => {
    return res.status(400).json({ error: 'playlist_like_not_supported_by_current_schema' });
  });
}
