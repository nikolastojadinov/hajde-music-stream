import { Router } from 'express';
import { browseArtistById } from '../services/youtubeMusicClient';

const router = Router();

function normalizeString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function looksLikeVideoId(value: string | undefined): value is string {
  return typeof value === 'string' && /^[A-Za-z0-9_-]{11}$/.test(value.trim());
}

router.get('/', async (req, res) => {
  const browseId = normalizeString((req.query.browseId as string) || (req.query.id as string));
  if (!browseId) {
    return res.status(400).json({ error: 'browse_id_required' });
  }

  try {
    const data = await browseArtistById(browseId);
    if (!data) {
      return res.json({ artistName: null, thumbnails: null, topSongs: [], albums: [] });
    }

    const topSongs = (data.topSongs || []).filter((t) => looksLikeVideoId(t.youtubeId)).map((t) => ({
      id: t.id,
      title: t.title,
      youtubeId: t.youtubeId,
      artist: t.artist,
      imageUrl: t.imageUrl ?? null,
    }));

    const albums = Array.isArray(data.albums)
      ? data.albums.map((a) => ({ id: a.id, title: a.title, imageUrl: a.imageUrl ?? null, channelTitle: a.channelTitle ?? null }))
      : [];

    res.set('Cache-Control', 'no-store');
    return res.json({
      artistName: data.artist.name,
      thumbnails: { avatar: data.artist.thumbnailUrl, banner: data.artist.bannerUrl },
      topSongs,
      albums,
    });
  } catch (err: any) {
    console.error('[browse/artist] failed', { browseId, message: err?.message });
    return res.status(500).json({ error: 'artist_browse_failed' });
  }
});

export default router;
