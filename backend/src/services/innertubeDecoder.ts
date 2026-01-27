import supabase from './supabaseClient';
import { parseInnertubeSearch } from '../lib/youtubeMusicClient';
import { parsePlaylistFromInnertube } from '../lib/innertube/playlistParser';
import { parseArtistBrowseFromInnertube } from './ytmArtistParser';
import { canonicalArtistName, normalizeArtistKey } from '../utils/artistKey';

const BATCH_LIMIT = 5;

type RawPayloadRow = {
  id: string;
  request_type?: string | null;
  request_key?: string | null;
  endpoint?: string | null;
  source?: string | null;
  query?: string | null;
  artist_key?: string | null;
  payload: any;
};

type ArtistEntity = {
  artist_key: string;
  artist: string;
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

function deriveArtistFromName(nameRaw: string | null | undefined): { artist_key: string; artist: string; normalized_name: string } | null {
  const artist = canonicalArtistName(nameRaw || '');
  if (!artist) return null;
  const key = normalizeArtistKey(artist);
  if (!key) return null;
  return { artist_key: key, artist, normalized_name: artist.toLowerCase() };
}

function decodeSearchPayload(row: RawPayloadRow): EntityBundle {
  const parsed = parseInnertubeSearch(row.payload || {}, row.query || undefined);
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
    description: null,
    image_url: parsed.thumbnail,
    cover_url: parsed.thumbnail,
    is_public: true,
    item_count: parsed.tracks.length || parsed.trackCount || 0,
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

function resolveType(row: RawPayloadRow): string | null {
  return row.request_type || row.endpoint || row.source || null;
}

function resolveKey(row: RawPayloadRow): string | null {
  return row.request_key || row.query || row.artist_key || null;
}

function decodePayload(row: RawPayloadRow): EntityBundle {
  const requestType = resolveType(row);
  const requestKey = resolveKey(row);
  const shapedRow: RawPayloadRow = { ...row, request_type: requestType || undefined, request_key: requestKey || undefined };

  if (requestType === 'search') return decodeSearchPayload(shapedRow);
  if (requestType === 'playlist') return decodePlaylistPayload(shapedRow);
  if (requestType === 'artist') return decodeArtistPayload(shapedRow);
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

  const now = new Date().toISOString();

  // Artists
  if (bundle.artists.length > 0) {
    const channelIds = Array.from(new Set(bundle.artists.map((a) => (a.youtube_channel_id || '').trim()).filter(Boolean)));
    const channelMap: Record<string, string> = {};
    if (channelIds.length > 0) {
      const { data, error } = await supabase
        .from('artists')
        .select('artist_key, youtube_channel_id')
        .in('youtube_channel_id', channelIds);
      if (error) throw new Error(error.message);
      (data || []).forEach((row: any) => {
        const channel = (row?.youtube_channel_id || '').trim();
        const key = (row?.artist_key || '').trim();
        if (channel && key) channelMap[channel] = key;
      });
    }

    const artistRows = bundle.artists.map((a) => ({
      artist_key: channelMap[(a.youtube_channel_id || '').trim()] || a.artist_key,
      artist: a.artist,
      normalized_name: a.normalized_name,
      youtube_channel_id: a.youtube_channel_id,
      subscriber_count: a.subscriber_count,
      view_count: a.view_count,
      thumbnails: a.thumbnails,
      country: a.country,
      updated_at: now,
    }));

    const { error } = await supabase.from('artists').upsert(artistRows, { onConflict: 'artist_key' });
    if (error) throw new Error(error.message);
  }

  // Albums
  if (bundle.albums.length > 0) {
    const albumRows = bundle.albums.map((al) => ({
      external_id: al.external_id,
      title: al.title,
      artist_key: al.artist_key,
      thumbnail_url: al.thumbnail_url,
      release_date: al.release_date,
      track_count: al.track_count,
      total_duration_seconds: al.total_duration_seconds,
      updated_at: now,
    }));

    const { error } = await supabase.from('albums').upsert(albumRows, { onConflict: 'external_id' });
    if (error) throw new Error(error.message);
  }

  // Map album external_id -> id for track linkage
  let albumIdMap: Record<string, string> = {};
  if (bundle.albums.length > 0) {
    const albumIds = bundle.albums.map((a) => a.external_id).filter(Boolean);
    const { data, error } = await supabase
      .from('albums')
      .select('id, external_id')
      .in('external_id', albumIds);
    if (error) throw new Error(error.message);
    albumIdMap = Object.fromEntries((data || []).map((row: any) => [row.external_id, row.id]));
  }

  // Tracks
  if (bundle.tracks.length > 0) {
    const trackRows = bundle.tracks.map((t) => ({
      youtube_id: t.youtube_id,
      title: t.title,
      artist: t.artist,
      artist_key: t.artist_key,
      artist_channel_id: t.artist_channel_id,
      album_id: t.album_external_id ? albumIdMap[t.album_external_id] || null : null,
      duration: t.duration,
      cover_url: t.cover_url,
      image_url: t.image_url,
      published_at: t.published_at,
      region: t.region,
      category: t.category,
      sync_status: 'fetched',
      source: 'youtube',
      last_synced_at: now,
      last_updated_at: now,
    }));

    const { error } = await supabase.from('tracks').upsert(trackRows, { onConflict: 'youtube_id' });
    if (error) throw new Error(error.message);
  }

  // Playlists
  if (bundle.playlists.length > 0) {
    const playlistRows = bundle.playlists.map((p) => ({
      external_id: p.external_id,
      title: p.title,
      description: p.description,
      cover_url: p.cover_url,
      image_url: p.image_url,
      channel_id: p.channel_id,
      item_count: p.item_count,
      region: p.region,
      country: p.country,
      view_count: p.view_count,
      quality_score: p.quality_score,
      is_public: p.is_public ?? true,
      last_refreshed_on: now,
      last_etag: p.last_etag,
      validated: p.validated ?? true,
      validated_on: p.validated_on ?? now,
      updated_at: now,
    }));

    const { error } = await supabase.from('playlists').upsert(playlistRows, { onConflict: 'external_id' });
    if (error) throw new Error(error.message);
  }

  // Map playlist external_id -> id for playlist_tracks
  let playlistIdMap: Record<string, string> = {};
  if (bundle.playlists.length > 0) {
    const playlistIds = bundle.playlists.map((p) => p.external_id).filter(Boolean);
    const { data, error } = await supabase
      .from('playlists')
      .select('id, external_id')
      .in('external_id', playlistIds);
    if (error) throw new Error(error.message);
    playlistIdMap = Object.fromEntries((data || []).map((row: any) => [row.external_id, row.id]));
  }

  // Map track youtube_id -> id for playlist_tracks
  let trackIdMap: Record<string, string> = {};
  if (bundle.tracks.length > 0) {
    const trackIds = bundle.tracks.map((t) => t.youtube_id).filter(Boolean);
    const { data, error } = await supabase
      .from('tracks')
      .select('id, youtube_id')
      .in('youtube_id', trackIds);
    if (error) throw new Error(error.message);
    trackIdMap = Object.fromEntries((data || []).map((row: any) => [row.youtube_id, row.id]));
  }

  // Playlist-track links
  if (bundle.playlistTracks.length > 0) {
    const linkRows = bundle.playlistTracks
      .map((pt) => {
        const playlist_id = playlistIdMap[pt.playlist_external_id];
        const track_id = trackIdMap[pt.youtube_id];
        if (!playlist_id || !track_id) return null;
        return { playlist_id, track_id, position: pt.position ?? 0 };
      })
      .filter(Boolean) as Array<{ playlist_id: string; track_id: string; position: number }>;

    if (linkRows.length > 0) {
      const { error } = await supabase.from('playlist_tracks').upsert(linkRows, { onConflict: 'playlist_id,track_id' });
      if (error) throw new Error(error.message);
    }
  }

  // Mark payload processed
  const { error: updateError } = await supabase
    .from('innertube_raw_payloads')
    .update({ status: 'processed', processed_at: now, error_message: null })
    .eq('id', row.id);
  if (updateError) throw new Error(updateError.message);
}

export async function runInnertubeDecoderOnce(): Promise<void> {
  if (!supabase) {
    console.warn('[innertubeDecoder] supabase not configured; skip run');
    return;
  }

  const { data, error } = await supabase
    .from('innertube_raw_payloads')
    .select('id, request_type, request_key, endpoint, source, query, artist_key, payload')
    .eq('status', 'pending')
    .order('created_at', { ascending: true })
    .limit(BATCH_LIMIT);

  if (error) {
    console.error('[innertubeDecoder] failed to load pending payloads', error.message);
    return;
  }

  for (const row of data as RawPayloadRow[]) {
    const type = resolveType(row);
    if (!type) {
      await markError(row.id, 'unknown_request_type');
      continue;
    }

    try {
      const bundle = decodePayload(row);
      await ingest(row, bundle);
      console.info('[innertubeDecoder] processed payload', { id: row.id, type });
    } catch (err: any) {
      console.error('[innertubeDecoder] payload failed', { id: row.id, type: row.request_type, message: err?.message });
      await markError(row.id, err?.message || 'decode_failed');
    }
  }
}
