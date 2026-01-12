import { Router } from 'express';
import { browsePlaylistById } from '../services/youtubeMusicClient';
import { ingestPlaylistOrAlbum, type PlaylistIngestKind } from '../services/entityIngestion';

const router = Router();

function normalizeString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function resolveKind(raw: string | undefined | null, browseId: string): PlaylistIngestKind {
  const normalized = normalizeString(raw).toLowerCase();
  if (normalized === 'album') return 'album';
  if (normalized === 'playlist') return 'playlist';

  const upper = browseId.toUpperCase();
  if (upper.startsWith('MPRE')) return 'album';
  return 'playlist';
}

router.get('/', async (req, res) => {
  const browseId = normalizeString((req.query.browseId as string) || (req.query.playlistId as string) || (req.query.id as string));
  const kind = resolveKind(req.query.kind as string | undefined, browseId);
  if (!browseId) {
    return res.status(400).json({ error: 'playlist_id_required' });
  }

  try {
    const data = await browsePlaylistById(browseId);
    if (!data) {
      return res.json({ id: browseId, title: '', subtitle: '', thumbnail: '', tracks: [] });
    }

    const id = data.playlistId
      ? (() => {
          const upper = data.playlistId.toUpperCase();
          return upper.startsWith('VL') || upper.startsWith('MPRE') || upper.startsWith('OLAK')
            ? data.playlistId
            : `VL${data.playlistId}`;
        })()
      : browseId;
    const tracks = Array.isArray(data.tracks)
      ? data.tracks.map((t) => ({
          videoId: normalizeString(t.videoId),
          title: normalizeString(t.title),
          artist: normalizeString(t.artist),
          duration: t.duration ?? '',
          thumbnail: normalizeString(t.thumbnail),
        }))
      : [];

    if (data) {
      await ingestPlaylistOrAlbum({
        browseId,
        kind,
        title: data.title,
        subtitle: data.subtitle,
        thumbnailUrl: data.thumbnailUrl,
        tracks: tracks.map((t) => ({
          videoId: t.videoId,
          title: t.title,
          artist: t.artist,
          duration: t.duration,
          thumbnail: t.thumbnail,
        })),
      });
    }

    res.set('Cache-Control', 'no-store');
    return res.json({
      id,
      title: normalizeString(data.title),
      subtitle: normalizeString(data.subtitle),
      thumbnail: normalizeString(data.thumbnailUrl),
      tracks,
    });
  } catch (err: any) {
    console.error('[browse/playlist] failed', { browseId, message: err?.message });
    return res.status(500).json({ error: 'playlist_browse_failed' });
  }
});

export default router;
