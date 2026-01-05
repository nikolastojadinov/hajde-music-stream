import { Router } from 'express';

import { fetchChannelDetails, fetchChannelPlaylists } from '../services/youtubeChannelService';
import { youtubeSearchMixed, youtubeSearchVideos } from '../services/youtubeClient';

const router = Router();

const MIN_QUERY_CHARS = 2;

function normalizeString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

async function pickArtistChannel(query: string) {
  const mixed = await youtubeSearchMixed(query);
  if (mixed.channels.length > 0) return mixed.channels[0];
  // As a fallback, infer channel from the top video
  if (mixed.videos.length > 0 && mixed.videos[0].channelId) {
    const v = mixed.videos[0];
    return { channelId: v.channelId, title: v.channelTitle || query, thumbUrl: v.thumbUrl };
  }
  return null;
}

router.get('/', async (req, res) => {
  const artistQuery = normalizeString((req.query.artist_key as string) || (req.query.artist as string));
  if (artistQuery.length < MIN_QUERY_CHARS) {
    return res.status(400).json({ error: 'artist_required' });
  }

  try {
    const channel = await pickArtistChannel(artistQuery);
    if (!channel) {
      return res.status(404).json({ error: 'artist_not_found' });
    }

    const details = await fetchChannelDetails(channel.channelId).catch(() => null);
    const playlists = await fetchChannelPlaylists(channel.channelId).catch(() => []);
    const topVideos = await youtubeSearchVideos(details?.title || artistQuery).catch(() => []);

    const artistMedia = {
      artist_name: details?.title || channel.title || artistQuery,
      youtube_channel_id: channel.channelId,
      thumbnail_url: details?.thumbnailUrl || channel.thumbUrl || null,
      banner_url: details?.bannerUrl || null,
    };

    const mappedPlaylists = playlists.map((p) => ({
      id: p.id,
      title: p.title,
      youtube_playlist_id: p.id,
      description: p.description ?? null,
      cover_url: p.thumbnailUrl ?? null,
      channel_title: p.channelTitle ?? artistMedia.artist_name,
      youtube_channel_id: p.channelId,
      source: 'youtube_live',
      created_at: null,
      like_count: null,
      view_count: null,
      public_like_count: null,
      public_view_count: null,
    }));

    const mappedTracks = topVideos.map((v) => ({
      id: v.videoId,
      title: v.title,
      youtube_video_id: v.videoId,
      cover_url: v.thumbUrl ?? null,
      duration: null,
      youtube_channel_id: v.channelId,
      artist_name: v.channelTitle || artistMedia.artist_name,
      created_at: null,
    }));

    res.set('Cache-Control', 'no-store');
    return res.json({ status: 'ok', artist: artistMedia, playlists: mappedPlaylists, tracks: mappedTracks });
  } catch (err: any) {
    console.error('[artist] failed', { message: err?.message || 'unknown' });
    return res.status(500).json({ error: 'artist_fetch_failed' });
  }
});

export default router;
