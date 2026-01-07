import { Router } from 'express';
import { browsePlaylistById } from '../services/youtubeMusicClient';

const router = Router();

function normalizeString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function looksLikeVideoId(value: string | undefined): value is string {
  return typeof value === 'string' && /^[A-Za-z0-9_-]{11}$/.test(value.trim());
}

router.get('/', async (req, res) => {
  const playlistId = normalizeString((req.query.playlistId as string) || (req.query.id as string));
  if (!playlistId) {
    return res.status(400).json({ error: 'playlist_id_required' });
  }

  try {
    const data = await browsePlaylistById(playlistId);
    if (!data) {
      return res.json({ title: null, coverImage: null, tracks: [] });
    }

    const tracks = (data.tracks || []).filter((t) => looksLikeVideoId(t.youtubeId)).map((t) => ({
      id: t.id,
      title: t.title,
      youtubeId: t.youtubeId,
      artist: t.artist ?? null,
      imageUrl: t.imageUrl ?? null,
    }));

    res.set('Cache-Control', 'no-store');
    return res.json({
      title: data.title,
      coverImage: data.thumbnailUrl,
      tracks,
    });
  } catch (err: any) {
    console.error('[browse/playlist] failed', { playlistId, message: err?.message });
    return res.status(500).json({ error: 'playlist_browse_failed' });
  }
});

export default router;
