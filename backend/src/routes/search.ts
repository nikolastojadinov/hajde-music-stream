import { Router } from 'express';

import supabase, {
  searchPlaylistsDualForQuery,
  searchArtistChannelsForQuery,
  searchTracksForQuery,
  type SearchArtistChannelRow,
  type SearchPlaylistRow,
  type SearchTrackRow,
} from '../services/supabaseClient';
import { spotifySearch } from '../services/spotifyClient';
import { youtubeSearchVideos } from '../services/youtubeClient';

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

type LocalArtistChannel = {
  artist_name: string;
  youtube_channel_id: string;
  is_verified: boolean;
};

type YouTubeArtistChannel = {
  artist_name: string;
  youtube_channel_id: string;
  is_verified: boolean;
  thumbnailUrl: string | null;
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

function mapTrackRow(row: SearchTrackRow): LocalTrack {
  return {
    id: String(row.id),
    title: typeof row.title === 'string' ? row.title : '',
    artist: typeof row.artist === 'string' ? row.artist : '',
    externalId: typeof row.external_id === 'string' ? row.external_id : null,
    coverUrl: typeof row.cover_url === 'string' ? row.cover_url : null,
    duration: typeof row.duration === 'number' ? row.duration : null,
  };
}

function mapPlaylistRow(row: SearchPlaylistRow): LocalPlaylist {
  return {
    id: String(row.id),
    title: typeof row.title === 'string' ? row.title : '',
    externalId: typeof row.external_id === 'string' ? row.external_id : null,
    coverUrl: typeof row.cover_url === 'string' ? row.cover_url : null,
  };
}

function mapArtistChannelRow(row: SearchArtistChannelRow): LocalArtistChannel | null {
  const artist_name = typeof row.artist_name === 'string' ? row.artist_name : '';
  const youtube_channel_id = typeof row.youtube_channel_id === 'string' ? row.youtube_channel_id : '';
  const is_verified = typeof row.is_verified === 'boolean' ? row.is_verified : false;

  if (!artist_name || !youtube_channel_id) return null;

  return { artist_name, youtube_channel_id, is_verified };
}

function mergeLegacyPlaylists(byTitle: LocalPlaylist[], byArtist: LocalPlaylist[]): LocalPlaylist[] {
  const seen = new Set<string>();
  const merged: LocalPlaylist[] = [];

  for (const p of byTitle) {
    if (!seen.has(p.id)) {
      seen.add(p.id);
      merged.push(p);
    }
  }

  for (const p of byArtist) {
    if (!seen.has(p.id)) {
      seen.add(p.id);
      merged.push(p);
    }
  }

  return merged;
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
      tracks: [],
      playlists_by_title: [],
      playlists_by_artist: [],
      artist_channels: {
        local: [],
        youtube: [],
        decision: 'local_only',
      },
      local: { tracks: [], playlists: [] },
      decision: 'local_only',
    });
  }

  try {
    const [trackRows, playlistsDual, artistChannelRows] = await Promise.all([
      searchTracksForQuery(q),
      searchPlaylistsDualForQuery(q),
      searchArtistChannelsForQuery(q),
    ]);

    const tracks = trackRows.map(mapTrackRow);
    const playlists_by_title = playlistsDual.playlists_by_title.map(mapPlaylistRow);
    const playlists_by_artist = playlistsDual.playlists_by_artist.map(mapPlaylistRow);
    const artist_channels_local = artistChannelRows.map(mapArtistChannelRow).filter((x): x is LocalArtistChannel => Boolean(x));

    const local = {
      tracks,
      playlists: mergeLegacyPlaylists(playlists_by_title, playlists_by_artist),
    };

    const artist_channels = {
      local: artist_channels_local,
      youtube: [] as YouTubeArtistChannel[],
      decision: 'local_only' as 'local_only' | 'youtube_fallback',
    };

    const hasLocal = tracks.length > 0 || playlists_by_title.length > 0 || playlists_by_artist.length > 0;
    if (hasLocal) {
      return res.json({
        q,
        tracks,
        playlists_by_title,
        playlists_by_artist,
        artist_channels,
        local,
        decision: 'local_only',
      });
    }

    // Default fallback: videos (music category) for all modes.
    // Note: playlist search is Supabase-only; no YouTube playlist search here.
    void mode;

    const videos = await youtubeSearchVideos(q);

    if (artist_channels_local.length === 0) {
      const seen = new Set<string>();
      const youtubeChannels: YouTubeArtistChannel[] = [];

      for (const v of videos) {
        if (!v.channelId || seen.has(v.channelId)) continue;
        seen.add(v.channelId);
        youtubeChannels.push({
          artist_name: v.channelTitle,
          youtube_channel_id: v.channelId,
          is_verified: false,
          thumbnailUrl: v.thumbUrl ?? null,
        });
        if (youtubeChannels.length >= 2) break;
      }

      artist_channels.youtube = youtubeChannels;
      artist_channels.decision = 'youtube_fallback';
    }

    return res.json({
      q,
      tracks,
      playlists_by_title,
      playlists_by_artist,
      artist_channels,
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
