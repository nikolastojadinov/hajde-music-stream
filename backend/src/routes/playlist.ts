import { Router } from 'express';

import { trackActivity } from '../lib/activityTracker';
import { ingestPlaylistOrAlbum } from '../services/ingestPlaylistOrAlbum';
import { youtubeInnertubeBrowsePlaylist } from '../services/youtubeInnertubeBrowsePlaylist';
import { resolveUserId } from '../lib/resolveUserId';

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

    const tracks = (result.videoIds || []).map((videoId) => ({
      videoId,
      title: '',
      artist: '',
      duration: null,
      thumbnail: null,
    }));

    if (tracks.length) {
      await ingestPlaylistOrAlbum(
        {
          browseId: playlistId,
          kind: 'playlist',
          title: result.title,
          subtitle: result.author ?? null,
          thumbnailUrl: result.thumbnailUrl ?? null,
          tracks,
        },
        { mode: 'single-playlist' },
      );
    }

    const userId = resolveUserId(req);
    if (userId) {
      void trackActivity({
        userId,
        entityType: 'playlist',
        entityId: playlistId,
        context: { source: 'playlist', browseId: playlistId },
      });
    }

    res.set('Cache-Control', 'no-store');
    return res.json(result);
  } catch (err: any) {
    console.error('[playlist] failed', { message: err?.message || 'unknown', playlistId });
    return res.status(500).json({ error: 'playlist_fetch_failed' });
  }
});

export default router;
