import { Router } from 'express';

import { trackActivity } from '../lib/trackActivity';
import { ingestPlaylistOrAlbum } from '../services/ingestPlaylistOrAlbum';
import supabase from '../services/supabaseClient';
import { browsePlaylistById } from '../services/youtubeMusicClient';
import { resolveUserId } from '../lib/resolveUserId';

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

type PlaylistTrackRow = {
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

type PlaylistRow = {
  external_id: string | null;
  title: string | null;
  cover_url: string | null;
  image_url: string | null;
  playlist_tracks: PlaylistTrackRow[] | null;
};

function normalizeString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
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

async function fetchPlaylistFromDatabase(externalId: string): Promise<PlaylistRow | null> {
  if (!supabase) return null;

  const { data, error } = await supabase
    .from('playlists')
    .select(
      [
        'external_id',
        'title',
        'cover_url',
        'image_url',
        'playlist_tracks(position, track:tracks(youtube_id,title,artist,duration,cover_url,image_url))',
      ].join(','),
    )
    .eq('external_id', externalId)
    .order('position', { foreignTable: 'playlist_tracks', ascending: true })
    .maybeSingle();

  if (error) {
    throw new Error(`[playlist_lookup] ${error.message}`);
  }

  return (data as PlaylistRow | null) ?? null;
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

function normalizePlaylistResponse(
  playlist: PlaylistRow | null,
  fallbackId: string,
  title?: string,
  subtitle?: string,
  thumbnail?: string | null,
) {
  if (!playlist) {
    return {
      id: fallbackId,
      title: title ? normalizeString(title) : '',
      subtitle: subtitle ? normalizeString(subtitle) : '',
      thumbnail: thumbnail ? normalizeString(thumbnail) : '',
      tracks: [] as Array<{ videoId: string; title: string; artist: string; duration: string; thumbnail: string | null }>,
    };
  }

  const tracks = Array.isArray(playlist.playlist_tracks)
    ? playlist.playlist_tracks
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
    id: normalizeString(playlist.external_id) || fallbackId,
    title: normalizeString(playlist.title) || normalizeString(title) || '',
    subtitle: normalizeString(subtitle),
    thumbnail: normalizeString(playlist.cover_url) || normalizeString(playlist.image_url) || normalizeString(thumbnail),
    tracks,
  };
}

router.get('/', async (req, res) => {
  const browseId = normalizeString((req.query.browseId as string) || (req.query.playlistId as string) || (req.query.id as string));
  const upper = browseId.toUpperCase();
  const isAlbum = upper.startsWith('MPRE');

  if (!browseId) {
    return res.status(400).json({ error: 'playlist_id_required' });
  }

  try {
    if (isAlbum) {
      let album = await fetchAlbumFromDatabase(browseId);

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
      const userId = resolveUserId(req);
      if (userId) {
        void trackActivity({
          userId,
          entityType: 'album_open',
          entityId: browseId,
          context: { source: 'browse_album', browseId },
        });
      } else {
        console.log('[trackActivity] SKIP', { reason: 'missing_userId', entityType: 'album_open', entityId: browseId });
      }
      res.set('Cache-Control', 'no-store');
      return res.json(payload);
    }

    let playlist = await fetchPlaylistFromDatabase(browseId);
    if (playlist && Array.isArray(playlist.playlist_tracks) && playlist.playlist_tracks.length > 0) {
      const payload = normalizePlaylistResponse(playlist, browseId);
      res.set('Cache-Control', 'no-store');
      const userId = resolveUserId(req);
      if (userId) {
        void trackActivity({
          userId,
          entityType: 'playlist_open',
          entityId: browseId,
          context: { source: 'browse_playlist', browseId },
        });
      } else {
        console.log('[trackActivity] SKIP', { reason: 'missing_userId', entityType: 'playlist_open', entityId: browseId });
      }
      return res.json(payload);
    }

    const data = await browsePlaylistById(browseId);
    if (!data) {
      return res.status(404).json({ error: 'playlist_not_found' });
    }

    const tracks = Array.isArray(data.tracks)
      ? data.tracks.map((t) => ({
          videoId: normalizeString(t.videoId),
          title: normalizeString(t.title),
          artist: normalizeString(t.artist),
          duration: t.duration ?? '',
          thumbnail: normalizeString(t.thumbnail),
        }))
      : [];

    if (tracks.length) {
      await ingestPlaylistOrAlbum(
        {
          browseId,
          kind: 'playlist',
          title: data.title,
          subtitle: data.subtitle,
          thumbnailUrl: data.thumbnailUrl,
          tracks,
        },
        { mode: 'single-playlist' },
      );

      playlist = await fetchPlaylistFromDatabase(browseId);
    }

    const payload = normalizePlaylistResponse(playlist, browseId, data.title, data.subtitle, data.thumbnailUrl);
    const userId = resolveUserId(req);
    if (userId) {
      void trackActivity({
        userId,
        entityType: 'playlist_open',
        entityId: browseId,
        context: { source: 'browse_playlist', browseId },
      });
    } else {
      console.log('[trackActivity] SKIP', { reason: 'missing_userId', entityType: 'playlist_open', entityId: browseId });
    }
    res.set('Cache-Control', 'no-store');
    return res.json(payload);
  } catch (err: any) {
    console.error('[browse/playlist] failed', { browseId, message: err?.message });
    return res.status(500).json({ error: 'playlist_browse_failed' });
  }
});

export default router;
