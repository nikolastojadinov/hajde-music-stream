import { Router } from 'express';

import { ingestPlaylistOrAlbum, type PlaylistIngestKind } from '../services/entityIngestion';
import supabase from '../services/supabaseClient';
import { browsePlaylistById } from '../services/youtubeMusicClient';

const router = Router();

type AlbumTrackRow = {
  position: number | null;
  track: {
    youtube_id: string | null;
    title: string | null;
    artist: string | null;
    duration: number | null;
    cover_url: string | null;
    image_url: string | null;
  } | null;
};

type AlbumRow = {
  external_id: string | null;
  title: string | null;
  thumbnail_url: string | null;
  release_date: string | null;
  album_tracks: AlbumTrackRow[] | null;
};

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

function formatDuration(seconds: number | null | undefined): string {
  if (!Number.isFinite(seconds)) return '';
  const total = Math.max(0, Math.trunc(seconds as number));
  const mins = Math.floor(total / 60);
  const secs = total % 60;
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}

async function fetchAlbumFromDatabase(externalId: string): Promise<AlbumRow | null> {
  if (!supabase) return null;

  const { data, error } = await supabase
    .from('albums')
    .select(
      [
        'external_id',
        'title',
        'thumbnail_url',
        'release_date',
        'album_tracks(position, track:tracks(youtube_id,title,artist,duration,cover_url,image_url))',
      ].join(','),
    )
    .eq('external_id', externalId)
    .order('position', { foreignTable: 'album_tracks', ascending: true })
    .maybeSingle();

  if (error) {
    throw new Error(`[album_lookup] ${error.message}`);
  }

  return (data as AlbumRow | null) ?? null;
}

function normalizeAlbumResponse(album: AlbumRow | null, fallbackId: string) {
  if (!album) {
    return {
      id: fallbackId,
      title: '',
      subtitle: '',
      thumbnail: '',
      tracks: [] as Array<{ videoId: string; title: string; artist: string; duration: string; thumbnail: string | null }>,
    };
  }

  const tracks = Array.isArray(album.album_tracks)
    ? album.album_tracks
        .filter((row) => row?.track?.youtube_id)
        .map((row) => ({
          videoId: normalizeString(row.track?.youtube_id),
          title: normalizeString(row.track?.title) || 'Untitled',
          artist: normalizeString(row.track?.artist),
          duration: formatDuration(row.track?.duration),
          thumbnail: normalizeString(row.track?.cover_url) || normalizeString(row.track?.image_url) || null,
        }))
    : [];

  return {
    id: normalizeString(album.external_id) || fallbackId,
    title: normalizeString(album.title),
    subtitle: album.release_date ? normalizeString(album.release_date) : '',
    thumbnail: normalizeString(album.thumbnail_url),
    tracks,
  };
}

router.get('/', async (req, res) => {
  const browseId = normalizeString((req.query.browseId as string) || (req.query.playlistId as string) || (req.query.id as string));
  const kind = resolveKind(req.query.kind as string | undefined, browseId);

  if (!browseId) {
    return res.status(400).json({ error: 'playlist_id_required' });
  }

  try {
    // Album detail: read from albums -> album_tracks -> tracks
    if (kind === 'album') {
      let album = await fetchAlbumFromDatabase(browseId);

      // If album not present yet, trigger ingestion via existing flow then re-read
      if (!album || !Array.isArray(album.album_tracks) || album.album_tracks.length === 0) {
        try {
          const browseResult = await browsePlaylistById(browseId);
          if (browseResult) {
            await ingestPlaylistOrAlbum({
              browseId,
              kind: 'album',
              title: browseResult.title,
              subtitle: browseResult.subtitle,
              thumbnailUrl: browseResult.thumbnailUrl,
              tracks: Array.isArray(browseResult.tracks)
                ? browseResult.tracks.map((t) => ({
                    videoId: normalizeString(t.videoId),
                    title: normalizeString(t.title),
                    artist: normalizeString(t.artist),
                    duration: t.duration ?? '',
                    thumbnail: normalizeString(t.thumbnail),
                  }))
                : [],
            });
            album = await fetchAlbumFromDatabase(browseId);
          }
        } catch (ingestErr) {
          console.warn('[browse/album] ingest fallback failed', {
            browseId,
            message: ingestErr instanceof Error ? ingestErr.message : String(ingestErr),
          });
        }
      }

      const payload = normalizeAlbumResponse(album, browseId);
      res.set('Cache-Control', 'no-store');
      return res.json(payload);
    }

    // Playlist detail (unchanged: live browse + ingest)
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
