import { Router } from 'express';

import { browseArtistById } from '../services/youtubeMusicClient';

const router = Router();

function normalizeString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

router.get('/', async (req, res) => {
  const browseId = normalizeString((req.query.id as string) || (req.query.browseId as string));

  if (!browseId) {
    return res.status(400).json({ error: 'artist_required' });
  }

  try {
    const browse = await browseArtistById(browseId);
    if (!browse) {
      return res.status(404).json({ error: 'artist_not_found' });
    }

    const mappedTracks = browse.topSongs
      .filter((v) => normalizeString(v.youtubeId).length === 11 && normalizeString(v.title))
      .map((v) => ({
        id: v.id,
        title: v.title,
        youtube_video_id: v.youtubeId,
        cover_url: v.imageUrl ?? null,
        duration: null,
        youtube_channel_id: browse.artist.channelId,
        artist_name: v.artist || browse.artist.name,
        created_at: null,
      }));

    res.set('Cache-Control', 'no-store');
    return res.json({
      status: 'ok',
      artist: {
        artist_name: browse.artist.name,
        youtube_channel_id: browse.artist.channelId,
        thumbnail_url: browse.artist.thumbnailUrl,
        banner_url: browse.artist.bannerUrl,
      },
      playlists: [],
      tracks: mappedTracks,
      meta: {},
    });
  } catch {
    return res.status(500).json({ error: 'artist_fetch_failed' });
  }
});

export default router;
