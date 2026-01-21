import { canonicalArtistName, normalizeArtistKey } from '../utils/artistKey';
import { getSupabaseAdmin } from './supabaseClient';
import type { ArtistBrowse } from './youtubeMusicClient';

export { ingestPlaylistOrAlbum, getAlbumCompletion, isAlbumComplete } from './ingestPlaylistOrAlbum';

export type TrackSelectionInput = {
  type: 'song' | 'video' | 'episode';
  youtubeId: string;
  title?: string;
  subtitle?: string | null;
  imageUrl?: string | null;
};

const VIDEO_ID_REGEX = /^[A-Za-z0-9_-]{11}$/;
const NOW = () => new Date().toISOString();

type ArtistInput = { name: string; channelId?: string | null; thumbnails?: { avatar?: string | null; banner?: string | null }; source?: string | null };
type AlbumInput = { externalId: string; title: string; thumbnailUrl?: string | null; releaseDate?: string | null; albumType?: string | null; artistKeys?: string[] };
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

type CanonicalArtistParams = {
  displayName: string;
  youtubeChannelId?: string | null;
  source?: string | null;
  thumbnails?: { avatar?: string | null; banner?: string | null } | null;
  artistDescription?: string | null;
};

function normalize(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeKey(value: string | null | undefined): string {
  const base = normalize(value);
  const normalized = normalizeArtistKey(base);
  return normalized || base;
}

function normalizeArtistDisplayName(name: string): string {
  return normalize(canonicalArtistName(name));
}

function normalizeChannelId(channelId?: string | null): string | null {
  const normalized = normalize(channelId);
  return normalized || null;
}

function deriveArtistKeyFromChannelId(channelId: string): string {
  const key = normalizeArtistKey(channelId);
  if (!key) throw new Error('[artist] missing artist_key from youtube_channel_id');
  return key;
}

function deriveArtistKeyFromName(displayName: string): string {
  const key = normalizeArtistKey(displayName);
  if (!key) throw new Error('[artist] missing artist_key from displayName');
  return key;
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

async function resolveCanonicalArtist(params: CanonicalArtistParams): Promise<{ artistKey: string; displayName: string } | null> {
  const client = getSupabaseAdmin();
  const displayName = normalizeArtistDisplayName(params.displayName) || params.displayName;
  const youtubeChannelId = normalizeChannelId(params.youtubeChannelId);
  const source = normalize(params.source) || 'unknown';
  const thumbnails = params.thumbnails ?? null;
  const artistDescription = normalize(params.artistDescription);
  const artistKey = normalizeArtistKey(displayName);
  const normalizedName = artistKey || normalize(displayName);

  if (!displayName) throw new Error('[artist] displayName is required');
  if (!artistKey) throw new Error('[artist] artist_key is required');

  const isEmpty = (value: unknown): boolean => normalize(value) === '';

  // Channel-present path: authoritative identity and only insertion path
  if (youtubeChannelId) {
    const { data: existing, error: existingError } = await client
      .from('artists')
      .select('id, artist_key, display_name, artist, youtube_channel_id, artist_description, thumbnails')
      .eq('youtube_channel_id', youtubeChannelId)
      .maybeSingle();
    if (existingError) throw new Error(`[artist] channel lookup ${existingError.message}`);

    if (existing) {
      const updatePayload: Record<string, any> = { updated_at: NOW() };
      if (!existing.youtube_channel_id) updatePayload.youtube_channel_id = youtubeChannelId;
      if (isEmpty(existing.artist_description) && artistDescription) updatePayload.artist_description = artistDescription;
      if (!existing.thumbnails && thumbnails) updatePayload.thumbnails = thumbnails;
      if (isEmpty(existing.display_name) && displayName) updatePayload.display_name = displayName;
      if (isEmpty(existing.artist) && displayName) updatePayload.artist = displayName;
      if (isEmpty(existing.normalized_name) && normalizedName) updatePayload.normalized_name = normalizedName;
      if (Object.keys(updatePayload).length > 1 || (Object.keys(updatePayload).length === 1 && !updatePayload.updated_at)) {
        const { error: updateErr } = await client.from('artists').update(updatePayload).eq('id', existing.id);
        if (updateErr) throw new Error(`[artist] channel update ${updateErr.message}`);
      }
      return { artistKey: existing.artist_key, displayName: existing.display_name || displayName };
    }

    const { data: existingByKey, error: existingKeyError } = await client
      .from('artists')
      .select('id, artist_key, display_name, artist_description, thumbnails, youtube_channel_id')
      .eq('artist_key', artistKey)
      .maybeSingle();
    if (existingKeyError) throw new Error(`[artist] key lookup ${existingKeyError.message}`);

    if (existingByKey) {
      const updatePayload: Record<string, any> = { updated_at: NOW() };
      if (!existingByKey.youtube_channel_id) updatePayload.youtube_channel_id = youtubeChannelId;
      if (isEmpty(existingByKey.artist_description) && artistDescription) updatePayload.artist_description = artistDescription;
      if (!existingByKey.thumbnails && thumbnails) updatePayload.thumbnails = thumbnails;
      if (isEmpty(existingByKey.display_name) && displayName) updatePayload.display_name = displayName;
      if (isEmpty(existingByKey.artist) && displayName) updatePayload.artist = displayName;
      if (isEmpty(existingByKey.normalized_name) && normalizedName) updatePayload.normalized_name = normalizedName;
      const { error: updateErr } = await client.from('artists').update(updatePayload).eq('id', existingByKey.id);
      if (updateErr) throw new Error(`[artist] key update ${updateErr.message}`);
      return { artistKey: existingByKey.artist_key, displayName: existingByKey.display_name || displayName };
    }

    const { data: inserted, error: insertError } = await client
      .from('artists')
      .insert({
        artist: displayName,
        display_name: displayName,
        artist_key: artistKey,
        normalized_name: normalizedName,
        youtube_channel_id: youtubeChannelId,
        thumbnails,
        source,
        artist_description: artistDescription || null,
        updated_at: NOW(),
      })
      .select('artist_key, display_name')
      .single();

    if (insertError) throw new Error(`[artist] insert ${insertError.message}`);

    return { artistKey: inserted.artist_key, displayName: inserted.display_name || displayName };
  }

  // No channel id: lookup only, never insert
  const fallbackKey = deriveArtistKeyFromName(displayName);
  const { data: existingByKey, error: fallbackError } = await client
    .from('artists')
    .select('id, artist_key, display_name, artist_description, thumbnails, youtube_channel_id, artist, normalized_name')
    .eq('artist_key', fallbackKey)
    .maybeSingle();
  if (fallbackError) throw new Error(`[artist] fallback lookup ${fallbackError.message}`);

  if (existingByKey) {
    const updatePayload: Record<string, any> = { updated_at: NOW() };
    if (youtubeChannelId && !existingByKey.youtube_channel_id) updatePayload.youtube_channel_id = youtubeChannelId;
    if (isEmpty(existingByKey.artist_description) && artistDescription) updatePayload.artist_description = artistDescription;
    if (!existingByKey.thumbnails && thumbnails) updatePayload.thumbnails = thumbnails;
    if (isEmpty(existingByKey.display_name) && displayName) updatePayload.display_name = displayName;
    if (isEmpty(existingByKey.artist) && displayName) updatePayload.artist = displayName;
    if (isEmpty(existingByKey.normalized_name) && normalizedName) updatePayload.normalized_name = normalizedName;
    if (Object.keys(updatePayload).length > 0) {
      const { error: updateErr } = await client.from('artists').update(updatePayload).eq('id', existingByKey.id);
      if (updateErr) throw new Error(`[artist] fallback update ${updateErr.message}`);
    }
    return { artistKey: existingByKey.artist_key, displayName: existingByKey.display_name || displayName };
  }

  return null;
}

async function upsertArtists(inputs: ArtistInput[], sourceHint?: string): Promise<ArtistResult> {
  if (!inputs.length) return { keys: [], count: 0 };

  const seen = new Set<string>();
  const keys: string[] = [];

  for (const artist of uniqueBy(inputs, (a) => `${normalize(a.channelId) || ''}::${normalize(a.name)}`)) {
    const resolved = await resolveCanonicalArtist({
      displayName: artist.name,
      youtubeChannelId: artist.channelId,
      source: artist.source || sourceHint || 'ingest',
      thumbnails: artist.thumbnails ?? null,
    });

    if (!resolved) continue;

    if (!seen.has(resolved.artistKey)) {
      seen.add(resolved.artistKey);
      keys.push(resolved.artistKey);
    }
  }

  return { keys, count: keys.length };
}

async function upsertAlbums(inputs: AlbumInput[]): Promise<{ map: IdMap; count: number }> {
  if (!inputs.length) return { map: {}, count: 0 };
  const client = getSupabaseAdmin();
  const rows = uniqueBy(
    inputs.map((a) => ({
      external_id: normalize(a.externalId),
      title: normalize(a.title) || 'Album',
      thumbnail_url: a.thumbnailUrl ?? null,
      release_date: a.releaseDate ? a.releaseDate : null,
      album_type: a.albumType ?? null,
      artist_key: Array.isArray(a.artistKeys) && a.artistKeys.length > 0 ? a.artistKeys[0] : null,
      updated_at: NOW(),
    })),
    (row) => row.external_id,
  ).filter((row) => Boolean(row.external_id));

  if (!rows.length) return { map: {}, count: 0 };

  const { error } = await client.from('albums').upsert(rows, { onConflict: 'external_id' });
  if (error) throw new Error(`[upsertAlbums] ${error.message}`);

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
): Promise<{ idMap: IdMap; artistTrackPairs: Array<{ trackId: string; artistKeys: string[] }>; count: number }> {
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

  const artistTrackPairs: Array<{ trackId: string; artistKeys: string[] }> = [];
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

async function linkArtistTracks(pairs: Array<{ trackId: string; artistKeys: string[] }>): Promise<number> {
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

function orderedTrackIds(tracks: Array<{ videoId: string }>, idMap: IdMap): string[] {
  return tracks
    .map((t) => normalize(t.videoId))
    .map((id) => idMap[id])
    .filter(Boolean);
}

function buildArtistTrackPairs(
  trackResult: { idMap: IdMap; artistTrackPairs: Array<{ trackId: string; artistKeys: string[] }> },
  fallbackArtistKeys: string[],
  videoOrder: string[],
): Array<{ trackId: string; artistKeys: string[] }> {
  const pairs: Array<{ trackId: string; artistKeys: string[] }> = [];
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

export async function ingestArtistBrowse(browse: ArtistBrowse, opts?: { allowArtistWrite?: boolean }): Promise<{ artistKey: string }> {
  const allowArtistWrite = opts?.allowArtistWrite !== false;
  const artistName = browse.artist.name;
  const resolved = await resolveCanonicalArtist({
    displayName: artistName,
    youtubeChannelId: browse.artist.channelId,
    source: 'artist_browse',
    thumbnails: { avatar: browse.artist.thumbnailUrl, banner: browse.artist.bannerUrl },
  });

  if (!resolved) throw new Error('[artist_browse] missing canonical artist resolution');

  const { artistKey, displayName } = resolved;

  if (!allowArtistWrite) {
    return { artistKey };
  }

  const artistInputs: ArtistInput[] = [
    {
      name: displayName,
      channelId: browse.artist.channelId,
      thumbnails: { avatar: browse.artist.thumbnailUrl, banner: browse.artist.bannerUrl },
    },
  ];

  const topSongTracks: TrackInput[] = (browse.topSongs || []).map((song) => ({
    youtubeId: song.id,
    title: song.title,
    artistNames: [displayName],
    durationSeconds: null,
    thumbnailUrl: song.imageUrl ?? null,
    isVideo: true,
    source: 'artist_top_song',
  }));

  const albumInputs: AlbumInput[] = (browse.albums || []).map((album) => ({
    externalId: album.id,
    title: album.title,
    thumbnailUrl: album.imageUrl ?? null,
    releaseDate: album.year ? `${album.year}-01-01` : null,
    albumType: null,
    artistKeys: [artistKey],
  }));

  const playlistInputs: PlaylistInput[] = (browse.playlists || []).map((pl) => ({
    externalId: pl.id,
    title: pl.title,
    thumbnailUrl: pl.imageUrl ?? null,
    channelId: browse.artist.channelId ?? null,
  }));

  const artistResult: ArtistResult = await upsertArtists(artistInputs, 'artist_browse');
  const effectiveArtistKeys = uniqueKeys([artistKey, ...artistResult.keys]);

  const albumResult = await upsertAlbums(albumInputs);
  const playlistResult = await upsertPlaylists(playlistInputs);
  const trackResult = await upsertTracks(topSongTracks, albumResult.map);

  const artistTrackPairs = buildArtistTrackPairs(trackResult, effectiveArtistKeys, topSongTracks.map((t) => t.youtubeId));
  const artistTrackCount = await linkArtistTracks(artistTrackPairs);
  const artistAlbumCount = effectiveArtistKeys.length && Object.values(albumResult.map).length
    ? await linkArtistAlbums(Object.values(albumResult.map), effectiveArtistKeys)
    : 0;

  console.info('[ingestArtistBrowse] ok', {
    artist_key: artistKey,
    artists: artistResult.count,
    albums: albumResult.count,
    playlists: playlistResult.count,
    tracks: trackResult.count,
    artist_tracks: artistTrackCount,
    artist_albums: artistAlbumCount,
  });

  return { artistKey };
}

export async function ingestTrackSelection(selection: TrackSelectionInput, opts?: { allowArtistWrite?: boolean }): Promise<void> {
  const allowArtistWrite = opts?.allowArtistWrite !== false;
  if (selection.type === 'episode') return;
  if (!selection.youtubeId || !VIDEO_ID_REGEX.test(selection.youtubeId)) return;

  const artists = allowArtistWrite ? splitArtists(selection.subtitle || '') || [] : [];
  const artistResult: ArtistResult = allowArtistWrite
    ? await upsertArtists(artists.map((name) => ({ name })), 'track_selection')
    : { keys: [], count: 0 };
  const trackResult = await upsertTracks(
    [
      {
        youtubeId: selection.youtubeId,
        title: selection.title || selection.subtitle || 'Untitled',
        artistNames: allowArtistWrite ? artists : [],
        thumbnailUrl: selection.imageUrl ?? null,
        isVideo: selection.type === 'video',
        source: selection.type,
      },
    ],
    {},
  );

  if (allowArtistWrite && Object.keys(trackResult.idMap).length) {
    const pairs = buildArtistTrackPairs(trackResult, artistResult.keys, [selection.youtubeId]);
    await linkArtistTracks(pairs);
  }

  console.info('[ingestTrackSelection] ok', {
    artists: artistResult.count,
    tracks: trackResult.count,
  });
}

export async function resolveCanonicalArtistKey(name: string, channelId?: string | null): Promise<string> {
  const resolved = await resolveCanonicalArtist({ displayName: name, youtubeChannelId: channelId, source: 'resolve_key' });
  if (!resolved) throw new Error('[artist] canonical key not found without youtube_channel_id');
  return resolved.artistKey;
}

export async function linkPlaylistTracksForExisting(playlistId: string, trackIds: string[]): Promise<number> {
  return linkPlaylistTracks(playlistId, trackIds);
}

export function deriveAlbumReleaseDate(subtitle: string | null | undefined): string | null {
  return parseAlbumReleaseDate(subtitle);
}

export function buildTrackPairsForTracks(
  trackResult: { idMap: IdMap; artistTrackPairs: Array<{ trackId: string; artistKeys: string[] }> },
  fallbackArtistKeys: string[],
  videoOrder: string[],
): Array<{ trackId: string; artistKeys: string[] }> {
  return buildArtistTrackPairs(trackResult, fallbackArtistKeys, videoOrder);
}
