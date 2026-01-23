import { Router } from 'express';

import { trackActivity } from '../lib/activityTracker';
import { ingestArtistBrowse } from '../services/entityIngestion';
import { browseArtistById } from '../services/youtubeMusicClient';
import { normalizeArtistKey } from '../utils/artistKey';
import { resolveUserId } from '../lib/resolveUserId';
import supabase from '../services/supabaseClient';

const router = Router();

const normalizeString = (value: unknown): string => (typeof value === 'string' ? value.trim() : '');
const looksLikeVideoId = (value: string | undefined | null): value is string =>
  typeof value === 'string' && /^[A-Za-z0-9_-]{11}$/.test(value.trim());

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

    const artistKey = normalizeArtistKey(browse.artist.name || '') || browse.artist.channelId || browseId;

    const artistDescription = normalizeString((browse as any)?.description);

    const mappedTracks = (Array.isArray(browse.topSongs) ? browse.topSongs : [])
      .filter((v) => looksLikeVideoId(v.id) && normalizeString(v.title))
      .map((v) => ({
        id: v.id,
        title: v.title,
        youtube_video_id: v.id,
        cover_url: v.imageUrl ?? null,
        duration: null,
        youtube_channel_id: browse.artist.channelId,
        artist_name: browse.artist.name,
        created_at: null,
      }));

    await ingestArtistBrowse(browse);

    const userId = resolveUserId(req);
    const exists = supabase
      ? await supabase.from('artists').select('artist_key').eq('artist_key', artistKey).limit(1).maybeSingle()
      : null;

    if (userId && exists?.data) {
      void trackActivity({
        userId,
        entityType: 'artist',
        entityId: artistKey,
        context: { source: 'artist', browseId },
      });
    }

    res.set('Cache-Control', 'no-store');
    return res.json({
      status: 'ok',
      artist: {
        artist_name: browse.artist.name,
        youtube_channel_id: browse.artist.channelId,
        thumbnail_url: browse.artist.thumbnailUrl,
        banner_url: browse.artist.bannerUrl,
        artist_description: artistDescription || null,
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
