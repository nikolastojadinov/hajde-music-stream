import { Router } from 'express';
import { youtubeInnertubeBrowsePlaylist } from '../services/youtubeInnertubeBrowsePlaylist';
import { ingestPlaylistOrAlbum } from '../services/entityIngestion';

const router = Router();

function normalizeString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

router.get('/', async (req, res) => {
  const playlistId = normalizeString((req.query.playlist_id as string) || (req.query.id as string));
  const maxRaw = req.query.max as string | undefined;
  const max = maxRaw ? Number(maxRaw) : null;

  if (!playlistId) {
    return res.status(400).json({ error: 'playlist_required' });
  }

  try {
    const result = await youtubeInnertubeBrowsePlaylist(playlistId, { max });
    if (!result) {
      return res.status(404).json({ error: 'playlist_not_found' });
    }

    await ingestPlaylistOrAlbum({
      browseId: playlistId,
      kind: 'playlist',
      title: result.title,
      subtitle: result.subtitle,
      thumbnailUrl: result.thumbnailUrl,
      tracks: result.tracks.map((t) => ({
        videoId: t.videoId,
        title: t.title,
        artist: t.artist,
        duration: t.duration ?? null,
        thumbnail: t.thumbnail ?? null,
      })),
    });

    res.set('Cache-Control', 'no-store');
    return res.json(result);
  } catch (err: any) {
    console.error('[playlist] failed', { message: err?.message || 'unknown', playlistId });
    return res.status(500).json({ error: 'playlist_fetch_failed' });
  }
});

export default router;
