import { canonicalArtistName, normalizeArtistKey } from '../utils/artistKey';
import { getSupabaseAdmin } from './supabaseClient';
import type { PlaylistBrowse } from './youtubeMusicClient';

const VIDEO_ID_REGEX = /^[A-Za-z0-9_-]{11}$/;
const NOW = () => new Date().toISOString();

export type PlaylistIngestKind = 'playlist' | 'album';
export type PlaylistIngestMode = 'single-playlist' | 'default';

export type PlaylistOrAlbumIngest = {
  browseId: string;
  kind: PlaylistIngestKind;
  title?: string | null;
  subtitle?: string | null;
  thumbnailUrl?: string | null;
  tracks: PlaylistBrowse['tracks'];
  trackCount?: number | null;
  channelId?: string | null;
};

export type PlaylistOrAlbumOptions = {
  primaryArtistKeys?: string[];
  allowArtistWrite?: boolean;
  mode?: PlaylistIngestMode;
};

export type PlaylistOrAlbumResult = {
  trackCount: number;
  albumTrackCount: number;
  playlistTrackCount: number;
  artistTrackCount: number;
  artistAlbumCount: number;
};

type ArtistInput = { name: string; channelId?: string | null; thumbnails?: { avatar?: string | null; banner?: string | null } };
type AlbumInput = {
  externalId: string;
  title: string;
  thumbnailUrl?: string | null;
  releaseDate?: string | null;
  albumType?: string | null;
  artistKeys?: string[];
  trackCount?: number | null;
};
type PlaylistInput = { externalId: string; title: string; description?: string | null; thumbnailUrl?: string | null; channelId?: string | null; itemCount?: number | null };
type TrackInput = {
  youtubeId: string;
  title: string;
  artistNames: string[];
  durationSeconds?: number | null;
  thumbnailUrl?: string | null;
  albumExternalId?: string | null;
  isVideo?: boolean;
  source?: string | null;
  isExplicit?: boolean | null;
};

type IdMap = Record<string, string>;
type ArtistResult = { keys: string[]; count: number };
type ArtistTrackPair = { trackId: string; artistKeys: string[] };
type AlbumCompletion = { albumId: string | null; expected: number | null; actual: number; percent: number; state: 'unknown' | 'partial' | 'complete' };

function normalize(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeKey(value: string | null | undefined): string {
  const base = normalize(value);
  const normalized = normalizeArtistKey(base);
  return normalized || base;
}

function uniqueStrings(values: Array<string | null | undefined>): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  values.forEach((value) => {
    const normalized = normalize(value);
    if (!normalized) return;
    const token = normalized.toLowerCase();
    if (seen.has(token)) return;
    seen.add(token);
    out.push(normalized);
  });
  return out;
}

function uniqueKeys(values: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  values.forEach((value) => {
    const key = normalizeKey(value);
    if (!key) return;
    const token = key.toLowerCase();
    if (seen.has(token)) return;
    seen.add(token);
    out.push(key);
  });
  return out;
}

function uniqueBy<T>(items: T[], keyFn: (item: T) => string): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  items.forEach((item) => {
    const key = keyFn(item);
    if (!key || seen.has(key)) return;
    seen.add(key);
    out.push(item);
  });
  return out;
}

function toSeconds(raw: string | null | undefined): number | null {
  const value = normalize(raw);
  if (!value) return null;
  if (/^\d+$/.test(value)) return Number.parseInt(value, 10);
  const parts = value
    .split(':')
    .map((p) => Number.parseInt(p, 10))
    .filter((n) => Number.isFinite(n));
  if (!parts.length) return null;
  return parts.reduce((acc, cur) => acc * 60 + cur, 0);
}

function splitArtists(raw: string | null | undefined): string[] {
  const value = normalize(raw);
  if (!value) return [];
  const cleaned = value
    .replace(/feat\.?/gi, ',')
    .replace(/ft\.?/gi, ',')
    .replace(/\u2022/g, ',')
    .replace(/·/g, ',')
    .replace(/&/g, ',')
    .replace(/\//g, ',');
  return cleaned
    .split(',')
    .map((part) => canonicalArtistName(part))
    .map((part) => normalize(part))
    .filter(Boolean);
}

function normalizeTrackSource(): 'youtube' {
  return 'youtube';
}

function deriveArtistKeys(names: string[]): { key: string; display: string }[] {
  const seen = new Set<string>();
  const out: { key: string; display: string }[] = [];
  names.forEach((name) => {
    const display = canonicalArtistName(name);
    const key = normalizeArtistKey(display || name);
    if (!key || seen.has(key)) return;
    seen.add(key);
    out.push({ key, display: display || key });
  });
  return out;
}

function normalizeTrackCount(value: number | null | undefined): number | null {
  if (typeof value !== 'number') return null;
  if (!Number.isFinite(value)) return null;
  if (value <= 0) return null;
  return Math.trunc(value);
}

function completionState(expected: number | null, actual: number): AlbumCompletion['state'] {
  if (!expected) return 'unknown';
  if (actual >= expected) return 'complete';
  return 'partial';
}

async function fetchAlbumCompletion(externalId: string): Promise<AlbumCompletion> {
  const client = getSupabaseAdmin();
  const key = normalize(externalId);
  if (!key) return { albumId: null, expected: null, actual: 0, percent: 0, state: 'unknown' };

  const { data: album, error } = await client
    .from('albums')
    .select('id, track_count')
    .eq('external_id', key)
    .maybeSingle();

  if (error) throw new Error(`[albumCompletion] ${error.message}`);

  const albumId = album?.id ?? null;
  const expected = normalizeTrackCount((album as any)?.track_count ?? null);

  if (!albumId) return { albumId: null, expected, actual: 0, percent: 0, state: completionState(expected, 0) };

  const { count, error: countError } = await client
    .from('album_tracks')
    .select('track_id', { count: 'exact', head: true })
    .eq('album_id', albumId);

  if (countError) throw new Error(`[albumCompletion] count ${countError.message}`);

  const actual = count ?? 0;
  const percent = expected ? Math.min(100, Math.round((actual / expected) * 100)) : 0;
  return { albumId, expected, actual, percent, state: completionState(expected, actual) };
}

async function computeAlbumCompletion(albumId: string | null): Promise<AlbumCompletion> {
  const client = getSupabaseAdmin();
  if (!albumId) return { albumId: null, expected: null, actual: 0, percent: 0, state: 'unknown' };

  const { data: album, error } = await client
    .from('albums')
    .select('track_count')
    .eq('id', albumId)
    .maybeSingle();

  if (error) throw new Error(`[computeAlbumCompletion] ${error.message}`);

  const expected = normalizeTrackCount((album as any)?.track_count ?? null);

  const { count, error: countError } = await client
    .from('album_tracks')
    .select('track_id', { count: 'exact', head: true })
    .eq('album_id', albumId);

  if (countError) throw new Error(`[computeAlbumCompletion] count ${countError.message}`);

  const actual = count ?? 0;
  const percent = expected ? Math.min(100, Math.round((actual / expected) * 100)) : 0;
  return { albumId, expected, actual, percent, state: completionState(expected, actual) };
}

export async function getAlbumCompletion(externalId: string): Promise<AlbumCompletion> {
  return fetchAlbumCompletion(externalId);
}

export async function isAlbumComplete(albumId: string | null): Promise<boolean> {
  const status = await computeAlbumCompletion(albumId);
  return status.state === 'complete';
}

async function upsertArtists(inputs: ArtistInput[]): Promise<ArtistResult> {
  if (!inputs.length) return { keys: [], count: 0 };
  const client = getSupabaseAdmin();

  const channelIds = Array.from(
    new Set(
      inputs
        .map((a) => normalize(a.channelId))
        .filter((v) => Boolean(v)),
    ),
  );

  const channelMap: Record<string, string> = {};
  if (channelIds.length) {
    const { data, error } = await client
      .from('artists')
      .select('artist_key, youtube_channel_id')
      .in('youtube_channel_id', channelIds);
    if (error) throw new Error(`[upsertArtists] channel lookup ${error.message}`);
    (data || []).forEach((row: any) => {
      const channel = normalize(row.youtube_channel_id);
      const key = normalize(row.artist_key);
      if (channel && key) channelMap[channel] = key;
    });
  }

  const rows = uniqueBy(
    inputs
      .map((artist) => {
        const display = canonicalArtistName(artist.name);
        const key = normalizeArtistKey(display || artist.name);
        const artistValue = normalize(display || artist.name || key);
        if (!key || !artistValue) return null;
        const channelId = normalize(artist.channelId) || null;
        const canonicalKey = channelId && channelMap[channelId] ? channelMap[channelId] : key;
        return {
          artist: artistValue,
          artist_key: canonicalKey,
          display_name: display || artist.name,
          normalized_name: artistValue.toLowerCase(),
          youtube_channel_id: channelId,
          thumbnails: artist.thumbnails || null,
          updated_at: NOW(),
        };
      })
      .filter(Boolean) as Array<Record<string, any>>,
    (row) => row.artist_key,
  );

  if (!rows.length) return { keys: [], count: 0 };

  const { error } = await client.from('artists').upsert(rows, { onConflict: 'artist_key' });
  if (error) throw new Error(`[upsertArtists] ${error.message}`);

  return { keys: rows.map((r) => r.artist_key as string), count: rows.length };
}

async function upsertAlbums(inputs: AlbumInput[]): Promise<{ map: IdMap; count: number }> {
  if (!inputs.length) return { map: {}, count: 0 };
  const client = getSupabaseAdmin();

  const prepared = inputs
    .map((a) => {
      const externalId = normalize(a.externalId);
      if (!externalId) return null;
      return {
        externalId,
        title: normalize(a.title) || 'Album',
        thumbnailUrl: a.thumbnailUrl ?? null,
        releaseDate: a.releaseDate ? a.releaseDate : null,
        albumType: a.albumType ?? null,
        artistKey: Array.isArray(a.artistKeys) && a.artistKeys.length > 0 ? a.artistKeys[0] : null,
        trackCount: normalizeTrackCount(a.trackCount),
      };
    })
    .filter(Boolean) as Array<{
    externalId: string;
    title: string;
    thumbnailUrl: string | null;
    releaseDate: string | null;
    albumType: string | null;
    artistKey: string | null;
    trackCount: number | null;
  }>;

  const rows = uniqueBy(
    prepared.map((a) => ({
      external_id: a.externalId,
      title: a.title,
      thumbnail_url: a.thumbnailUrl,
      release_date: a.releaseDate,
      album_type: a.albumType,
      artist_key: a.artistKey,
      updated_at: NOW(),
    })),
    (row) => row.external_id,
  ).filter((row) => Boolean(row.external_id));

  if (!rows.length) return { map: {}, count: 0 };

  const { error } = await client.from('albums').upsert(rows, { onConflict: 'external_id' });
  if (error) throw new Error(`[upsertAlbums] ${error.message}`);

  const trackCountTargets = uniqueBy(
    prepared
      .filter((p) => p.trackCount !== null)
      .map((p) => ({ external_id: p.externalId, track_count: p.trackCount as number })),
    (row) => row.external_id,
  );

  for (const target of trackCountTargets) {
    const { error: trackError } = await client
      .from('albums')
      .update({ track_count: target.track_count })
      .eq('external_id', target.external_id)
      .is('track_count', null);
    if (trackError) throw new Error(`[upsertAlbums] track_count ${trackError.message}`);
  }

  const { data, error: selectError } = await client
    .from('albums')
    .select('id, external_id')
    .in('external_id', rows.map((r) => r.external_id));
  if (selectError) throw new Error(`[upsertAlbums] ${selectError.message}`);

  const map: IdMap = {};
  (data || []).forEach((row: any) => {
    if (row?.external_id && row?.id) map[row.external_id] = row.id;
  });
  return { map, count: rows.length };
}

async function upsertPlaylists(inputs: PlaylistInput[]): Promise<{ map: IdMap; count: number }> {
  if (!inputs.length) return { map: {}, count: 0 };
  const client = getSupabaseAdmin();
  const now = NOW();

  const rows = uniqueBy(
    inputs.map((p) => ({
      external_id: normalize(p.externalId),
      title: normalize(p.title) || 'Playlist',
      description: p.description ?? null,
      cover_url: p.thumbnailUrl ?? null,
      image_url: p.thumbnailUrl ?? null,
      channel_id: normalize(p.channelId) || null,
      item_count: p.itemCount ?? null,
      is_public: true,
      last_refreshed_on: now,
      validated: true,
      validated_on: now,
      updated_at: now,
    })),
    (row) => row.external_id,
  ).filter((row) => Boolean(row.external_id));

  if (!rows.length) return { map: {}, count: 0 };

  const { error } = await client.from('playlists').upsert(rows, { onConflict: 'external_id' });
  if (error) throw new Error(`[upsertPlaylists] ${error.message}`);

  const { data, error: selectError } = await client
    .from('playlists')
    .select('id, external_id')
    .in('external_id', rows.map((r) => r.external_id));
  if (selectError) throw new Error(`[upsertPlaylists] ${selectError.message}`);

  const map: IdMap = {};
  (data || []).forEach((row: any) => {
    if (row?.external_id && row?.id) map[row.external_id] = row.id;
  });
  return { map, count: rows.length };
}

async function upsertTracks(
  inputs: TrackInput[],
  albumMap: IdMap,
): Promise<{ idMap: IdMap; artistTrackPairs: ArtistTrackPair[]; count: number }> {
  if (!inputs.length) return { idMap: {}, artistTrackPairs: [], count: 0 };
  const client = getSupabaseAdmin();
  const now = NOW();

  const prepared = inputs
    .map((t) => {
      const youtubeId = normalize(t.youtubeId);
      if (!youtubeId || !VIDEO_ID_REGEX.test(youtubeId)) return null;

      const artists = deriveArtistKeys(t.artistNames);
      const primaryArtistKey = artists[0]?.key ?? null;
      const albumId = t.albumExternalId ? albumMap[normalize(t.albumExternalId)] ?? null : null;

      return {
        row: {
          youtube_id: youtubeId,
          external_id: youtubeId,
          title: normalize(t.title) || 'Untitled',
          artist: artists[0]?.display || t.artistNames[0] || 'Unknown artist',
          artist_key: primaryArtistKey,
          duration: t.durationSeconds ?? null,
          cover_url: t.thumbnailUrl ?? null,
          image_url: t.thumbnailUrl ?? null,
          album_id: albumId,
          last_synced_at: now,
          last_updated_at: now,
          is_video: Boolean(t.isVideo),
          source: normalizeTrackSource(),
          sync_status: 'fetched',
          is_explicit: t.isExplicit ?? null,
        },
        artistKeys: artists.map((a) => a.key),
        youtubeId,
      };
    })
    .filter(Boolean) as Array<{ row: any; artistKeys: string[]; youtubeId: string }>;

  const rows = uniqueBy(prepared.map((p) => p.row), (row) => row.youtube_id).filter((row) => Boolean(row.youtube_id));
  if (!rows.length) return { idMap: {}, artistTrackPairs: [], count: 0 };

  const { error } = await client.from('tracks').upsert(rows, { onConflict: 'youtube_id' });
  if (error) throw new Error(`[upsertTracks] ${error.message}`);

  const { data, error: selectError } = await client
    .from('tracks')
    .select('id, youtube_id')
    .in('youtube_id', rows.map((r) => r.youtube_id));
  if (selectError) throw new Error(`[upsertTracks] ${selectError.message}`);

  const idMap: IdMap = {};
  (data || []).forEach((row: any) => {
    if (row?.youtube_id && row?.id) idMap[row.youtube_id] = row.id;
  });

  const artistTrackPairs: ArtistTrackPair[] = [];
  const seenPairs = new Set<string>();
  prepared.forEach((item) => {
    const trackId = idMap[item.youtubeId];
    if (!trackId || !item.artistKeys.length) return;
    const uniqueArtistKeys = uniqueKeys(item.artistKeys);
    uniqueArtistKeys.forEach((artistKey) => {
      const token = `${trackId}-${artistKey}`;
      if (seenPairs.has(token)) return;
      seenPairs.add(token);
      artistTrackPairs.push({ trackId, artistKeys: [artistKey] });
    });
  });

  return { idMap, artistTrackPairs, count: rows.length };
}

async function linkArtistTracks(pairs: ArtistTrackPair[]): Promise<number> {
  if (!pairs.length) return 0;
  const client = getSupabaseAdmin();
  const rows: Array<{ artist_key: string; track_id: string }> = [];
  const seen = new Set<string>();
  pairs.forEach((pair) => {
    pair.artistKeys.forEach((artistKey) => {
      const token = `${artistKey}-${pair.trackId}`;
      if (seen.has(token)) return;
      seen.add(token);
      rows.push({ artist_key: artistKey, track_id: pair.trackId });
    });
  });
  if (!rows.length) return 0;
  try {
    const { error } = await client.from('artist_tracks').upsert(rows, { onConflict: 'artist_key,track_id' });
    if (error) throw error;
    return rows.length;
  } catch (err: any) {
    console.error('[linkArtistTracks] failed', { message: err?.message || String(err) });
    return 0;
  }
}

async function linkArtistAlbums(albumIds: string[], artistKeys: string[]): Promise<number> {
  if (!albumIds.length || !artistKeys.length) return 0;
  const client = getSupabaseAdmin();
  const rows: Array<{ artist_key: string; album_id: string }> = [];
  albumIds.forEach((albumId) => {
    artistKeys.forEach((artistKey) => rows.push({ artist_key: artistKey, album_id: albumId }));
  });
  try {
    const { error } = await client.from('artist_albums').upsert(rows, { onConflict: 'artist_key,album_id' });
    if (error) throw error;
    return rows.length;
  } catch (err: any) {
    console.error('[linkArtistAlbums] failed', { message: err?.message || String(err) });
    return 0;
  }
}

async function linkAlbumTracks(albumId: string, trackIds: string[]): Promise<number> {
  if (!albumId || !trackIds.length) return 0;
  const client = getSupabaseAdmin();
  const rows = trackIds.map((trackId, index) => ({ album_id: albumId, track_id: trackId, position: index + 1 }));
  try {
    const { error } = await client.from('album_tracks').upsert(rows, { onConflict: 'album_id,track_id' });
    if (error) throw error;
    return rows.length;
  } catch (err: any) {
    console.error('[linkAlbumTracks] failed', { message: err?.message || String(err) });
    return 0;
  }
}

async function linkPlaylistTracks(playlistId: string, trackIds: string[]): Promise<number> {
  if (!playlistId || !trackIds.length) return 0;
  const client = getSupabaseAdmin();
  const rows = trackIds.map((trackId, index) => ({ playlist_id: playlistId, track_id: trackId, position: index + 1 }));
  try {
    const { error } = await client.from('playlist_tracks').upsert(rows, { onConflict: 'playlist_id,track_id' });
    if (error) throw error;
    return rows.length;
  } catch (err: any) {
    console.error('[linkPlaylistTracks] failed', { message: err?.message || String(err) });
    return 0;
  }
}

function parseAlbumReleaseDate(subtitle: string | null | undefined): string | null {
  const yearMatch = normalize(subtitle).match(/(19|20)\d{2}/);
  if (!yearMatch) return null;
  return `${yearMatch[0]}-01-01`;
}

function orderedTrackIds(tracks: PlaylistBrowse['tracks'], idMap: IdMap): string[] {
  return tracks
    .map((t) => normalize(t.videoId))
    .map((id) => idMap[id])
    .filter(Boolean);
}

function buildArtistTrackPairs(
  trackResult: { idMap: IdMap; artistTrackPairs: ArtistTrackPair[] },
  fallbackArtistKeys: string[],
  videoOrder: string[],
): ArtistTrackPair[] {
  const pairs: ArtistTrackPair[] = [];
  const seen = new Set<string>();
  const normalizedFallback = uniqueKeys(fallbackArtistKeys);

  const push = (trackId: string, artistKeys: string[]) => {
    const keys = uniqueKeys(artistKeys);
    keys.forEach((key) => {
      const token = `${trackId}-${key}`;
      if (seen.has(token)) return;
      seen.add(token);
      pairs.push({ trackId, artistKeys: [key] });
    });
  };

  trackResult.artistTrackPairs.forEach((pair) => push(pair.trackId, pair.artistKeys));
  videoOrder.forEach((youtubeId) => {
    const trackId = trackResult.idMap[normalize(youtubeId)];
    if (trackId) push(trackId, normalizedFallback);
  });
  Object.values(trackResult.idMap)
    .filter(Boolean)
    .forEach((trackId) => push(trackId, normalizedFallback));

  return pairs;
}

export async function ingestPlaylistOrAlbum(payload: PlaylistOrAlbumIngest, opts?: PlaylistOrAlbumOptions): Promise<PlaylistOrAlbumResult> {
  const mode = opts?.mode ?? 'default';

  if (payload.kind === 'playlist' && mode !== 'single-playlist') {
    console.warn('[playlist-ingest] aborted: playlist ingest must use mode=single-playlist');
    throw new Error('playlist_ingest_requires_single_mode');
  }

  if (!payload?.browseId) return { trackCount: 0, albumTrackCount: 0, playlistTrackCount: 0, artistTrackCount: 0, artistAlbumCount: 0 };
  const tracks = Array.isArray(payload.tracks) ? payload.tracks : [];
  if (!tracks.length) return { trackCount: 0, albumTrackCount: 0, playlistTrackCount: 0, artistTrackCount: 0, artistAlbumCount: 0 };

  const allowArtistWrite = opts?.allowArtistWrite !== false;
  const browseKey = normalize(payload.browseId);
  if (!browseKey) return { trackCount: 0, albumTrackCount: 0, playlistTrackCount: 0, artistTrackCount: 0, artistAlbumCount: 0 };

  const explicitTrackCount = normalizeTrackCount(payload.trackCount);
  const expectedTrackCount = payload.kind === 'album' ? explicitTrackCount ?? normalizeTrackCount(tracks.length) ?? tracks.length : null;

  let preIngestCompletion: AlbumCompletion | null = null;
  if (payload.kind === 'album') {
    preIngestCompletion = await getAlbumCompletion(browseKey);
    if (preIngestCompletion.expected !== null && preIngestCompletion.actual >= preIngestCompletion.expected) {
      console.info('[album-ingest] skipped (already complete)', {
        album_external_id: browseKey,
        album_id: preIngestCompletion.albumId,
        expected_tracks: preIngestCompletion.expected,
        actual_tracks: preIngestCompletion.actual,
        completion_percent: preIngestCompletion.percent,
        completion_state: preIngestCompletion.state,
      });
      return { trackCount: 0, albumTrackCount: 0, playlistTrackCount: 0, artistTrackCount: 0, artistAlbumCount: 0 };
    }
  }

  if (payload.kind === 'playlist') {
    console.info('[playlist-ingest] start', { browseId: browseKey });
  }

  const title = normalize(payload.title) || browseKey;
  const artistsFromSubtitle = splitArtists(payload.subtitle);
  const trackInputs: TrackInput[] = tracks.map((t) => ({
    youtubeId: normalize(t.videoId),
    title: normalize(t.title) || 'Untitled',
    artistNames: splitArtists(t.artist),
    durationSeconds: toSeconds(t.duration),
    thumbnailUrl: t.thumbnail ?? null,
    albumExternalId: payload.kind === 'album' ? browseKey : null,
    isVideo: true,
    source: payload.kind,
  }));

  const collectedArtistNames = uniqueStrings([...artistsFromSubtitle, ...trackInputs.flatMap((t) => t.artistNames)]);

  const artistResult: ArtistResult = allowArtistWrite ? await upsertArtists(collectedArtistNames.map((name) => ({ name }))) : { keys: [], count: 0 };
  const primaryKeys = allowArtistWrite ? uniqueKeys([...(opts?.primaryArtistKeys ?? []), ...artistResult.keys]) : [];

  const fallbackKeys = allowArtistWrite && primaryKeys.length
    ? primaryKeys
    : allowArtistWrite
      ? artistResult.keys
      : [];

  const albumResult = payload.kind === 'album'
    ? await upsertAlbums([
        {
          externalId: browseKey,
          title,
          thumbnailUrl: payload.thumbnailUrl ?? null,
          releaseDate: parseAlbumReleaseDate(payload.subtitle),
          albumType: null,
          artistKeys: primaryKeys,
          trackCount: expectedTrackCount,
        },
      ])
    : { map: {}, count: 0 };

  const playlistResult = payload.kind === 'playlist'
    ? await upsertPlaylists([
        {
          externalId: browseKey,
          title,
          description: payload.subtitle ?? null,
          thumbnailUrl: payload.thumbnailUrl ?? null,
          channelId: payload.channelId ?? null,
          itemCount: tracks.length,
        },
      ])
    : { map: {}, count: 0 };

  const trackResult = await upsertTracks(trackInputs, albumResult.map);

  const albumTrackIds = payload.kind === 'album' ? orderedTrackIds(tracks, trackResult.idMap) : [];
  const playlistTrackIds = payload.kind === 'playlist' ? orderedTrackIds(tracks, trackResult.idMap) : [];

  let albumTrackCount = 0;
  let artistAlbumCount = 0;
  let playlistTrackCount = 0;

  if (payload.kind === 'album' && albumTrackIds.length) {
    const albumId = albumResult.map[browseKey];
    if (albumId) {
      albumTrackCount = await linkAlbumTracks(albumId, albumTrackIds);
      if (allowArtistWrite && fallbackKeys.length) {
        artistAlbumCount = await linkArtistAlbums([albumId], fallbackKeys);
      }
    }
  }

  if (payload.kind === 'playlist' && playlistTrackIds.length) {
    const playlistId = playlistResult.map[browseKey];
    if (playlistId) {
      playlistTrackCount = await linkPlaylistTracks(playlistId, playlistTrackIds);
    }
  }

  const artistTrackPairs = allowArtistWrite
    ? buildArtistTrackPairs(trackResult, fallbackKeys, tracks.map((t) => t.videoId))
    : [];

  const artistTrackCount = allowArtistWrite ? await linkArtistTracks(artistTrackPairs) : 0;

  if (payload.kind === 'album') {
    const completionAfter = await getAlbumCompletion(browseKey);
    const albumId = completionAfter.albumId ?? albumResult.map[browseKey] ?? null;
    console.info('[album-ingest] album completion', {
      album_external_id: browseKey,
      album_id: albumId,
      expected_tracks: completionAfter.expected ?? expectedTrackCount,
      actual_tracks: completionAfter.actual,
      completion_percent: completionAfter.percent,
      completion_state: completionAfter.state,
    });
  }

  if (payload.kind === 'playlist') {
    console.info('[playlist-ingest] completed', {
      browseId: browseKey,
      tracks: trackResult.count,
      playlist_tracks: playlistTrackCount,
      artist_tracks: artistTrackCount,
    });
  }

  return {
    trackCount: trackResult.count,
    albumTrackCount,
    playlistTrackCount,
    artistTrackCount,
    artistAlbumCount,
  };
}
