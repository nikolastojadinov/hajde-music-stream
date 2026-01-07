import { Router } from 'express';

import { fetchArtistBrowse } from '../services/youtubeMusicClient';

const router = Router();

const MIN_QUERY_CHARS = 2;

function normalizeString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

router.get('/', async (req, res) => {
  const browseId = normalizeString((req.query.id as string) || (req.query.browseId as string));
  const artistQuery = normalizeString((req.query.artist_key as string) || (req.query.artist as string));

  if (!browseId && artistQuery.length < MIN_QUERY_CHARS) {
    return res.status(400).json({ error: 'artist_required' });
  }

  try {
    const identifier = browseId || artistQuery;
    const browse = await fetchArtistBrowse(identifier);
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
