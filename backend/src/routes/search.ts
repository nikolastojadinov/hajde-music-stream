import { Router } from 'express';

import supabase from '../services/supabaseClient';
import { spotifySearch } from '../services/spotifyClient';
import { youtubeSearchPlaylists, youtubeSearchVideos } from '../services/youtubeClient';

const router = Router();

type LocalTrack = {
  id: string;
  title: string;
  artist: string;
  externalId: string | null;
  coverUrl: string | null;
  duration: number | null;
};

type LocalPlaylist = {
  id: string;
  title: string;
  externalId: string | null;
  coverUrl: string | null;
};

type ResolveMode = 'track' | 'artist' | 'album' | 'generic';

type ResolveRequestBody = {
  q?: unknown;
  mode?: unknown;
  spotify?: unknown;
};

function normalizeQuery(input: unknown): string {
  return typeof input === 'string' ? input.trim() : '';
}

function normalizeMode(input: unknown): ResolveMode {
  const value = typeof input === 'string' ? input : '';
  if (value === 'track' || value === 'artist' || value === 'album' || value === 'generic') return value;
  return 'generic';
}

function shouldPreferPlaylistSearch(query: string): boolean {
  const q = query.toLowerCase();
  return q.includes('playlist') || q.includes('mix') || q.includes('radio');
}

async function searchLocal(query: string): Promise<{ tracks: LocalTrack[]; playlists: LocalPlaylist[] }> {
  if (!supabase) {
    return { tracks: [], playlists: [] };
  }

  const q = query.trim();
  if (q.length < 2) {
    return { tracks: [], playlists: [] };
  }

  const trackPromise = supabase
    .from('tracks')
    .select('id, title, artist, external_id, cover_url, duration')
    .or(`title.ilike.%${q}%,artist.ilike.%${q}%`)
    .limit(10);

  const playlistPromise = supabase
    .from('playlists')
    .select('id, title, external_id, cover_url')
    .ilike('title', `%${q}%`)
    .limit(10);

  const [tracksResult, playlistsResult] = await Promise.all([trackPromise, playlistPromise]);

  const tracks: LocalTrack[] = (tracksResult.data || [])
    .filter((row: any) => row && typeof row.id === 'string')
    .map((row: any) => ({
      id: String(row.id),
      title: typeof row.title === 'string' ? row.title : '',
      artist: typeof row.artist === 'string' ? row.artist : '',
      externalId: typeof row.external_id === 'string' ? row.external_id : null,
      coverUrl: typeof row.cover_url === 'string' ? row.cover_url : null,
      duration: typeof row.duration === 'number' ? row.duration : null,
    }));

  const playlists: LocalPlaylist[] = (playlistsResult.data || [])
    .filter((row: any) => row && typeof row.id === 'string')
    .map((row: any) => ({
      id: String(row.id),
      title: typeof row.title === 'string' ? row.title : '',
      externalId: typeof row.external_id === 'string' ? row.external_id : null,
      coverUrl: typeof row.cover_url === 'string' ? row.cover_url : null,
    }));

  return { tracks, playlists };
}

router.get('/suggest', async (req, res) => {
  const q = normalizeQuery(req.query.q);

  try {
    const result = await spotifySearch(q);
    return res.json({ q, source: 'spotify', ...result });
  } catch {
    return res.status(500).json({ error: 'Search suggest failed' });
  }
});

router.post('/resolve', async (req, res) => {
  const body = (req.body || {}) as ResolveRequestBody;
  const q = normalizeQuery(body.q);
  const mode = normalizeMode(body.mode);

  if (!supabase) {
    return res.status(503).json({ error: 'Search resolve unavailable' });
  }

  if (q.length < 2) {
    return res.json({
      q,
      local: { tracks: [], playlists: [] },
      decision: 'local_only',
    });
  }

  try {
    const local = await searchLocal(q);

    const hasLocal = local.tracks.length > 0 || local.playlists.length > 0;
    if (hasLocal) {
      return res.json({
        q,
        local,
        decision: 'local_only',
      });
    }

    // Fallback to YouTube (confirmed intent only). Enforce at most ONE YouTube call.
    const preferPlaylists = shouldPreferPlaylistSearch(q);

    if (preferPlaylists) {
      const playlists = await youtubeSearchPlaylists(q);
      return res.json({
        q,
        local,
        youtube: {
          playlists: playlists.map((p) => ({
            id: p.playlistId,
            title: p.title,
            channelTitle: p.channelTitle,
            thumbnailUrl: p.thumbUrl ?? null,
          })),
        },
        decision: 'youtube_fallback',
      });
    }

    // Default fallback: videos (music category) for all modes.
    // Mode is currently informational; fallback remains quota-safe.
    void mode;

    const videos = await youtubeSearchVideos(q);

    return res.json({
      q,
      local,
      youtube: {
        videos: videos.map((v) => ({
          id: v.videoId,
          title: v.title,
          channelTitle: v.channelTitle,
          thumbnailUrl: v.thumbUrl ?? null,
        })),
      },
      decision: 'youtube_fallback',
    });
  } catch {
    return res.status(500).json({ error: 'Search resolve failed' });
  }
});

export default router;
