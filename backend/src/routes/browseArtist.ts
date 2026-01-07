import { Router } from 'express';
import { browseArtistById } from '../services/youtubeMusicClient';

const router = Router();

const normalizeString = (value: unknown): string => (typeof value === 'string' ? value.trim() : '');

router.get('/', async (req, res) => {
  const browseId = normalizeString((req.query.browseId as string) || (req.query.id as string));
  if (!browseId) {
    return res.status(400).json({ error: 'browse_id_required' });
  }

  try {
    const data = await browseArtistById(browseId);
    const payload = {
      artistName: data?.artist.name ?? null,
      thumbnails: { avatar: data?.artist.thumbnailUrl ?? null, banner: data?.artist.bannerUrl ?? null },
      topSongs: Array.isArray(data?.topSongs)
        ? data.topSongs
            .map((t) => ({
              id: normalizeString(t.id),
              title: normalizeString(t.title) || 'Untitled',
              imageUrl: t.imageUrl ?? null,
              playCount: t.playCount ?? null,
            }))
            .filter((t) => Boolean(t.id))
        : [],
      albums: Array.isArray(data?.albums)
        ? data.albums
            .map((a) => ({
              id: normalizeString(a.id),
              title: normalizeString(a.title) || 'Album',
              imageUrl: a.imageUrl ?? null,
              year: a.year ?? null,
            }))
            .filter((a) => Boolean(a.id))
        : [],
      playlists: Array.isArray(data?.playlists)
        ? data.playlists
            .map((p) => ({
              id: normalizeString(p.id),
              title: normalizeString(p.title) || 'Playlist',
              imageUrl: p.imageUrl ?? null,
            }))
            .filter((p) => Boolean(p.id))
        : [],
    };

    res.set('Cache-Control', 'no-store');
    return res.json(payload);
  } catch (err: any) {
    console.error('[browse/artist] failed', { browseId, message: err?.message });
    return res.status(500).json({ error: 'artist_browse_failed' });
  }
});

export default router;
