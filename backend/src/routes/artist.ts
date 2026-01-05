import { Router } from 'express';

import { fetchArtistBrowse } from '../services/youtubeMusicClient';

const router = Router();

const MIN_QUERY_CHARS = 2;

function normalizeString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

router.get('/', async (req, res) => {
  const artistQuery = normalizeString((req.query.artist_key as string) || (req.query.artist as string));
  if (artistQuery.length < MIN_QUERY_CHARS) {
    return res.status(400).json({ error: 'artist_required' });
  }

  try {
    const browse = await fetchArtistBrowse(artistQuery);
    if (!browse) {
      return res.status(404).json({ error: 'artist_not_found' });
    }

    const mappedPlaylists = browse.albums.map((p) => ({
      id: p.id,
      title: p.title,
      youtube_playlist_id: p.id,
      description: null,
      cover_url: p.imageUrl ?? null,
      channel_title: p.channelTitle ?? browse.artist.name,
      youtube_channel_id: browse.artist.channelId,
      source: 'youtube_live',
      created_at: null,
      like_count: null,
      view_count: null,
      public_like_count: null,
      public_view_count: null,
    }));

    const mappedTracks = browse.topSongs.map((v) => ({
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
      playlists: mappedPlaylists,
      tracks: mappedTracks,
    });
  } catch (err: any) {
    console.error('[artist] failed', { message: err?.message || 'unknown' });
    return res.status(500).json({ error: 'artist_fetch_failed' });
  }
});

export default router;
