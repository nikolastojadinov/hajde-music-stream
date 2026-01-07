import { Router } from 'express';
import { browsePlaylistById } from '../services/youtubeMusicClient';

const router = Router();

function normalizeString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

router.get('/', async (req, res) => {
  const browseId = normalizeString((req.query.browseId as string) || (req.query.playlistId as string) || (req.query.id as string));
  if (!browseId) {
    return res.status(400).json({ error: 'playlist_id_required' });
  }

  try {
    const data = await browsePlaylistById(browseId);
    if (!data) {
      return res.json({ title: null, thumbnails: null, tracks: [] });
    }

    const tracks = Array.isArray(data.tracks)
      ? data.tracks.map((t) => ({
          videoId: t.videoId,
          title: t.title,
          artist: t.artist,
          duration: t.duration ?? null,
          thumbnails: t.thumbnail ? { default: t.thumbnail } : null,
        }))
      : [];

    res.set('Cache-Control', 'no-store');
    return res.json({
      title: data.title,
      thumbnails: { cover: data.thumbnailUrl },
      tracks,
    });
  } catch (err: any) {
    console.error('[browse/playlist] failed', { browseId, message: err?.message });
    return res.status(500).json({ error: 'playlist_browse_failed' });
  }
});

export default router;
