import supabase from './supabaseClient';
import { parseInnertubeSearch } from '../lib/youtubeMusicClient';
import { parsePlaylistFromInnertube } from '../lib/parsers/playlistParser';
import { parseArtistBrowseFromInnertube } from './ytmArtistParser';
import { canonicalArtistName, normalizeArtistKey } from '../utils/artistKey';

const BATCH_LIMIT = 5;

type RawPayloadRow = {
  id: string;
  request_type: string;
  request_key: string | null;
  payload: any;
};

type ArtistEntity = {
  artist_key: string;
  display_name: string;
  normalized_name: string;
  youtube_channel_id?: string | null;
  subscriber_count?: number | null;
  view_count?: number | null;
  thumbnails?: any;
  country?: string | null;
};

type AlbumEntity = {
  external_id: string;
  title: string;
  artist_key?: string | null;
  thumbnail_url?: string | null;
  release_date?: string | null;
  track_count?: number | null;
  total_duration_seconds?: number | null;
};

type TrackEntity = {
  youtube_id: string;
  title?: string | null;
  artist?: string | null;
  artist_key?: string | null;
  artist_channel_id?: string | null;
  album_external_id?: string | null;
  duration?: number | null;
  cover_url?: string | null;
  image_url?: string | null;
  published_at?: string | null;
  region?: string | null;
  category?: string | null;
};

type PlaylistEntity = {
  external_id: string;
  title?: string | null;
  description?: string | null;
  cover_url?: string | null;
  image_url?: string | null;
  channel_id?: string | null;
  item_count?: number | null;
  region?: string | null;
  country?: string | null;
  view_count?: number | null;
  quality_score?: number | null;
  is_public?: boolean | null;
  last_etag?: string | null;
  validated?: boolean | null;
  validated_on?: string | null;
};

type PlaylistTrackLink = {
  playlist_external_id: string;
  youtube_id: string;
  position: number;
};

type EntityBundle = {
  artists: ArtistEntity[];
  albums: AlbumEntity[];
  tracks: TrackEntity[];
  playlists: PlaylistEntity[];
  playlistTracks: PlaylistTrackLink[];
};

function uniqueBy<T>(items: T[], key: (t: T) => string): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const item of items) {
    const k = key(item);
    if (!k || seen.has(k)) continue;
    seen.add(k);
    out.push(item);
  }
  return out;
}

function normalizeTitle(value: string | null | undefined): string | null {
  if (typeof value !== 'string') return null;
  const t = value.trim();
  return t || null;
}

function deriveArtistFromName(nameRaw: string | null | undefined): { artist_key: string; display_name: string; normalized_name: string } | null {
  const display = canonicalArtistName(nameRaw || '');
  if (!display) return null;
  const key = normalizeArtistKey(display);
  if (!key) return null;
  return { artist_key: key, display_name: display, normalized_name: display.toLowerCase() };
}

function decodeSearchPayload(row: RawPayloadRow): EntityBundle {
  const parsed = parseInnertubeSearch(row.payload || {});
  const artists: ArtistEntity[] = [];
  const albums: AlbumEntity[] = [];
  const tracks: TrackEntity[] = [];
  const playlists: PlaylistEntity[] = [];
  const playlistTracks: PlaylistTrackLink[] = [];

  for (const item of parsed.sections.artists) {
    const artist = deriveArtistFromName(item.title);
    if (!artist) continue;
    artists.push({ ...artist, youtube_channel_id: item.endpointPayload });
  }

  for (const item of parsed.sections.songs) {
    const youtubeId = item.endpointPayload;
    if (!youtubeId) continue;
    const artistPart = (item.subtitle || '').split('·')[0]?.trim() || null;
    const artistBase = deriveArtistFromName(artistPart || item.subtitle || null);
    if (artistBase) artists.push({ ...artistBase });
    tracks.push({
      youtube_id: youtubeId,
      title: item.title,
      artist: artistPart || item.subtitle || null,
      artist_key: artistBase?.artist_key,
      image_url: item.imageUrl || null,
    });
  }

  for (const item of parsed.sections.albums) {
    const externalId = item.endpointPayload;
    if (!externalId) continue;
    const artistPart = (item.subtitle || '').split('·')[0]?.trim() || null;
    const artistBase = deriveArtistFromName(artistPart || item.subtitle || null);
    if (artistBase) artists.push({ ...artistBase });
    albums.push({
      external_id: externalId,
      title: item.title,
      artist_key: artistBase?.artist_key,
      thumbnail_url: item.imageUrl || null,
    });
  }

  for (const item of parsed.sections.playlists) {
    const externalId = item.endpointPayload;
    if (!externalId) continue;
    playlists.push({
      external_id: externalId,
      title: item.title,
      description: item.subtitle || null,
      image_url: item.imageUrl || null,
      is_public: true,
    });
  }

  return {
    artists: uniqueBy(artists, (a) => a.artist_key),
    albums: uniqueBy(albums, (a) => a.external_id),
    tracks: uniqueBy(tracks, (t) => t.youtube_id),
    playlists: uniqueBy(playlists, (p) => p.external_id),
    playlistTracks,
  };
}

function decodePlaylistPayload(row: RawPayloadRow): EntityBundle {
  const parsed = parsePlaylistFromInnertube(row.payload || {}, row.request_key || '');
  const playlistId = row.request_key || parsed.id;
  const playlist: PlaylistEntity = {
    external_id: playlistId,
    title: normalizeTitle(parsed.title) || playlistId,
    description: normalizeTitle(parsed.subtitle),
    image_url: parsed.thumbnail,
    cover_url: parsed.thumbnail,
    is_public: true,
    item_count: parsed.tracks.length,
  };

  const artists: ArtistEntity[] = [];
  const tracks: TrackEntity[] = [];
  const playlistTracks: PlaylistTrackLink[] = [];

  parsed.tracks.forEach((t, idx) => {
    const youtubeId = t.videoId || '';
    if (!youtubeId) return;
    const artistBase = deriveArtistFromName(t.artist);
    if (artistBase) artists.push({ ...artistBase });
    tracks.push({
      youtube_id: youtubeId,
      title: t.title,
      artist: t.artist,
      artist_key: artistBase?.artist_key,
      duration: t.duration ? Number.parseInt(t.duration, 10) || null : null,
      image_url: t.thumbnail,
      cover_url: t.thumbnail,
    });
    playlistTracks.push({ playlist_external_id: playlistId, youtube_id: youtubeId, position: idx + 1 });
  });

  return {
    artists: uniqueBy(artists, (a) => a.artist_key),
    albums: [],
    tracks: uniqueBy(tracks, (t) => t.youtube_id),
    playlists: [playlist],
    playlistTracks,
  };
}

function decodeArtistPayload(row: RawPayloadRow): EntityBundle {
  const parsed = parseArtistBrowseFromInnertube(row.payload || {}, row.request_key || '');
  const artistBase = deriveArtistFromName(parsed.artist.name);
  const artists: ArtistEntity[] = artistBase
    ? [{ ...artistBase, youtube_channel_id: parsed.artist.channelId, thumbnails: { avatar: parsed.artist.thumbnailUrl, banner: parsed.artist.bannerUrl } }]
    : [];

  const tracks: TrackEntity[] = [];
  parsed.topSongs.forEach((s) => {
    if (!s.id) return;
    tracks.push({
      youtube_id: s.id,
      title: s.title,
      artist: parsed.artist.name,
      artist_key: artistBase?.artist_key,
      image_url: s.imageUrl,
      cover_url: s.imageUrl,
    });
  });

  const albums: AlbumEntity[] = [];
  parsed.albums.forEach((a) => {
    if (!a.id) return;
    albums.push({
      external_id: a.id,
      title: a.title,
      artist_key: artistBase?.artist_key,
      thumbnail_url: a.imageUrl,
    });
  });

  const playlists: PlaylistEntity[] = [];
  parsed.playlists.forEach((p) => {
    if (!p.id) return;
    playlists.push({
      external_id: p.id,
      title: p.title,
      image_url: p.imageUrl,
      cover_url: p.imageUrl,
      channel_id: parsed.artist.channelId,
      is_public: true,
    });
  });

  return {
    artists,
    albums: uniqueBy(albums, (a) => a.external_id),
    tracks: uniqueBy(tracks, (t) => t.youtube_id),
    playlists: uniqueBy(playlists, (p) => p.external_id),
    playlistTracks: [],
  };
}

function decodePayload(row: RawPayloadRow): EntityBundle {
  if (row.request_type === 'search') return decodeSearchPayload(row);
  if (row.request_type === 'playlist') return decodePlaylistPayload(row);
  if (row.request_type === 'artist') return decodeArtistPayload(row);
  return { artists: [], albums: [], tracks: [], playlists: [], playlistTracks: [] };
}

async function markError(rowId: string, message: string): Promise<void> {
  if (!supabase) return;
  await supabase
    .from('innertube_raw_payloads')
    .update({ status: 'error', error_message: message.slice(0, 400) || 'decode_failed' })
    .eq('id', rowId);
}

async function ingest(row: RawPayloadRow, bundle: EntityBundle): Promise<void> {
  if (!supabase) throw new Error('supabase_not_configured');
  const { error } = await supabase.rpc('ingest_innertube_entities', {
    p_payload_id: row.id,
    p_artists: bundle.artists,
    p_albums: bundle.albums,
    p_tracks: bundle.tracks,
    p_playlists: bundle.playlists,
    p_playlist_tracks: bundle.playlistTracks,
  });

  if (error) {
    throw new Error(error.message);
  }
}

export async function runInnertubeDecoderOnce(): Promise<void> {
  if (!supabase) {
    console.warn('[innertubeDecoder] supabase not configured; skip run');
    return;
  }

  const { data, error } = await supabase
    .from('innertube_raw_payloads')
    .select('id, request_type, request_key, payload')
    .eq('status', 'pending')
    .order('created_at', { ascending: true })
    .limit(BATCH_LIMIT);

  if (error) {
    console.error('[innertubeDecoder] failed to load pending payloads', error.message);
    return;
  }

  for (const row of data as RawPayloadRow[]) {
    try {
      const bundle = decodePayload(row);
      await ingest(row, bundle);
      console.info('[innertubeDecoder] processed payload', { id: row.id, type: row.request_type });
    } catch (err: any) {
      console.error('[innertubeDecoder] payload failed', { id: row.id, type: row.request_type, message: err?.message });
      await markError(row.id, err?.message || 'decode_failed');
    }
  }
}
