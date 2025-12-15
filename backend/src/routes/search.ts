import { Router } from 'express';

import supabase, {
  searchArtistChannelsForQuery,
  searchPlaylistsDualForQuery,
  searchTracksForQuery,
  type SearchArtistChannelRow,
  type SearchPlaylistRow,
  type SearchTrackRow,
} from '../services/supabaseClient';
import { spotifySearch } from '../services/spotifyClient';
import { youtubeSearchVideos } from '../services/youtubeClient';

const router = Router();

type ResolveMode = 'track' | 'artist' | 'album' | 'generic';

type ResolveRequestBody = {
  q?: unknown;
  mode?: unknown;
  spotify?: unknown;
};

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

type ResolvedArtistChannel = {
  channelId: string;
  title: string;
  thumbnailUrl: string | null;
};

type ArtistChannelsEnvelope = {
  local: ResolvedArtistChannel[];
  youtube: ResolvedArtistChannel[];
  decision: 'local_only' | 'youtube_fallback';
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

function mapLocalArtistChannelRow(row: SearchArtistChannelRow): ResolvedArtistChannel | null {
  const title = typeof row.name === 'string' ? row.name.trim() : '';
  const channelId = typeof row.youtube_channel_id === 'string' ? row.youtube_channel_id.trim() : '';
  const thumbnailUrl = typeof row.thumbnail_url === 'string' ? row.thumbnail_url : null;

  if (!title || !channelId) return null;

  return { channelId, title, thumbnailUrl };
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

function deriveYouTubeArtistChannelsFromVideos(videos: Array<{ channelId: string; channelTitle: string; thumbUrl?: string | null }>): ResolvedArtistChannel[] {
  const seen = new Set<string>();
  const out: ResolvedArtistChannel[] = [];

  for (const v of videos) {
    const channelId = typeof v.channelId === 'string' ? v.channelId : '';
    const title = typeof v.channelTitle === 'string' ? v.channelTitle : '';
    if (!channelId || !title) continue;
    if (seen.has(channelId)) continue;

    seen.add(channelId);
    out.push({
      channelId,
      title,
      thumbnailUrl: v.thumbUrl ?? null,
    });

    if (out.length >= 2) break;
  }

  return out;
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
    const artist_channels: ArtistChannelsEnvelope = { local: [], youtube: [], decision: 'local_only' };

    return res.json({
      q,
      tracks: [],
      playlists_by_title: [],
      playlists_by_artist: [],
      artist_channels,
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

    const artistChannelsLocal = artistChannelRows
      .map(mapLocalArtistChannelRow)
      .filter((x): x is ResolvedArtistChannel => Boolean(x));

    const local = {
      tracks,
      playlists: mergeLegacyPlaylists(playlists_by_title, playlists_by_artist),
    };

    const artist_channels: ArtistChannelsEnvelope = {
      local: artistChannelsLocal,
      youtube: [],
      decision: artistChannelsLocal.length >= 1 ? 'local_only' : 'local_only',
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

    // Existing behavior: only YouTube fallback in the no-local-results branch.
    void mode;
    const videos = await youtubeSearchVideos(q);

    if (artist_channels.local.length === 0) {
      artist_channels.youtube = deriveYouTubeArtistChannelsFromVideos(videos);
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
