import { canonicalArtistName, normalizeArtistKey } from '../utils/artistKey';
import { getSupabaseAdmin } from './supabaseClient';
import { upsertArtists, type ArtistInput, type ArtistResult } from './upsertArtists';
import { linkArtistTracks, type ArtistTrackLink } from './linkArtistTracks';
import type { ArtistBrowse } from './youtubeMusicClient';

export { ingestPlaylistOrAlbum, getAlbumCompletion, isAlbumComplete } from './ingestPlaylistOrAlbum';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
export type TrackSelectionInput = {
  type: 'song' | 'video' | 'episode';
  youtubeId: string;
  title?: string;
  subtitle?: string | null;
  imageUrl?: string | null;
};

const VIDEO_ID_REGEX = /^[A-Za-z0-9_-]{11}$/;
const NOW = () => new Date().toISOString();

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
type DerivedArtist = { key: string; display: string; normalizedName: string };

type CanonicalArtistParams = {
  displayName: string;
  youtubeChannelId?: string | null;
  source?: string | null;
  thumbnails?: { avatar?: string | null; banner?: string | null } | null;
  artistDescription?: string | null;
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
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

function normalizeArtistLookupName(value: string): string {
  return normalizeArtistKey(canonicalArtistName(value) || value).toLowerCase();
}

function normalizeChannelId(channelId?: string | null): string | null {
  const normalized = normalize(channelId);
  return normalized || null;
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

function deriveArtistKeys(names: string[]): DerivedArtist[] {
  const seen = new Set<string>();
  const out: DerivedArtist[] = [];
  names.forEach((name) => {
    const display = canonicalArtistName(name) || name;
    const key = normalizeArtistKey(display || name);
    const normalizedName = normalizeArtistLookupName(display || key);
    if (!key || !normalizedName || seen.has(normalizedName)) return;
    seen.add(normalizedName);
    out.push({ key, display: display || key, normalizedName });
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

// ---------------------------------------------------------------------------
// Canonical artist resolution
// Identity is human-name only; channel is link-only and never used as identity.
// ---------------------------------------------------------------------------
async function resolveCanonicalArtist(params: CanonicalArtistParams): Promise<{ artistKey: string; displayName: string }> {
  const client = getSupabaseAdmin();
  const displayName = normalizeArtistDisplayName(params.displayName) || params.displayName;
  const youtubeChannelId = normalizeChannelId(params.youtubeChannelId);
  const source = normalize(params.source) || 'unknown';
  const thumbnails = params.thumbnails ?? null;
  const artistDescription = normalize(params.artistDescription);

  if (!displayName) throw new Error('[artist] displayName is required');

  const artistKey = normalizeArtistKey(displayName);
  if (!artistKey) throw new Error('[artist] artist_key is required');
  const normalizedName = artistKey;

  const isMissing = (value: unknown): boolean => normalize(value) === '' || value === null || value === undefined;
  const looksLikeChannelId = (value: unknown): boolean => {
    const v = normalize(value).toUpperCase();
    return /^UC[A-Z0-9_-]+$/.test(v);
  };
  const isChannelIdValue = (value: unknown): boolean => {
    const v = normalize(value);
    if (!v) return false;
    if (youtubeChannelId && v.toLowerCase() === youtubeChannelId.toLowerCase()) return true;
    return looksLikeChannelId(v);
  };

  const now = NOW();

  const maybeUpdate = async (id: string, existing: any) => {
    const updatePayload: Record<string, any> = { updated_at: now };

    if (youtubeChannelId && !existing.youtube_channel_id) updatePayload.youtube_channel_id = youtubeChannelId;
    if (isMissing(existing.artist_description) && artistDescription) updatePayload.artist_description = artistDescription;
    if (!existing.thumbnails && thumbnails) updatePayload.thumbnails = thumbnails;

    // Fix invalid or missing human-facing identity fields (never overwrite artist_key)
    if (isMissing(existing.display_name) || isChannelIdValue(existing.display_name)) updatePayload.display_name = displayName;
    if (isMissing(existing.artist) || isChannelIdValue(existing.artist)) updatePayload.artist = displayName;
    if (isMissing(existing.normalized_name) || isChannelIdValue(existing.normalized_name)) updatePayload.normalized_name = normalizedName;

    const hasChanges = Object.keys(updatePayload).length > 1; // more than just updated_at
    if (!hasChanges) return;

    const { error } = await client.from('artists').update(updatePayload).eq('id', id);
    if (error) throw new Error(`[artist] update ${error.message}`);
  };

  // 1) Match by channel id first (metadata link only)
  if (youtubeChannelId) {
    const { data: byChannel, error: channelErr } = await client
      .from('artists')
      .select('id, artist_key, display_name, artist, normalized_name, youtube_channel_id, artist_description, thumbnails')
      .eq('youtube_channel_id', youtubeChannelId)
      .maybeSingle();
    if (channelErr) throw new Error(`[artist] channel lookup ${channelErr.message}`);
    if (byChannel) {
      await maybeUpdate(byChannel.id, byChannel);
      return { artistKey: byChannel.artist_key, displayName: byChannel.display_name || displayName };
    }
  }

  // 2) Match by artist_key (human identity)
  const { data: byKey, error: keyErr } = await client
    .from('artists')
    .select('id, artist_key, display_name, artist, normalized_name, youtube_channel_id, artist_description, thumbnails')
    .eq('artist_key', artistKey)
    .maybeSingle();
  if (keyErr) throw new Error(`[artist] key lookup ${keyErr.message}`);
  if (byKey) {
    await maybeUpdate(byKey.id, byKey);
    return { artistKey: byKey.artist_key, displayName: byKey.display_name || displayName };
  }

  // 3) Insert new artist (name-derived identity only)
  const { data: inserted, error: insertErr } = await client
    .from('artists')
    .insert({
      artist: displayName,
      display_name: displayName,
      artist_key: artistKey,
      normalized_name: normalizedName,
      youtube_channel_id: youtubeChannelId || null,
      artist_description: artistDescription || null,
      thumbnails,
      source,
      updated_at: now,
    })
    .select('artist_key, display_name')
    .single();

  if (insertErr) throw new Error(`[artist] insert ${insertErr.message}`);

  return { artistKey: inserted.artist_key, displayName: inserted.display_name || displayName };
}

async function upsertAlbums(inputs: AlbumInput[]): Promise<{ map: IdMap; count: number }> {
  if (!inputs.length) return { map: {}, count: 0 };
  const client = getSupabaseAdmin();
  const prepared = uniqueBy(
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

  if (!prepared.length) return { map: {}, count: 0 };

  const artistCandidates = Array.from(new Set(prepared.map((row) => row.artist_key).filter((key): key is string => Boolean(key))));
  const validArtists = new Set<string>();

  if (artistCandidates.length) {
    const { data: artistRows, error: artistError } = await client
      .from('artists')
      .select('artist_key')
      .in('artist_key', artistCandidates);

    if (artistError) throw new Error(`[upsertAlbums] artist_lookup ${artistError.message}`);
    (artistRows || []).forEach((row: any) => {
      if (row?.artist_key) validArtists.add(row.artist_key);
    });
  }

  const rows = prepared.filter((row) => {
    if (!row.artist_key) return true;
    const exists = validArtists.has(row.artist_key);
    if (!exists) {
      console.info('[upsertAlbums] skipped_missing_artist', { external_id: row.external_id, artist_key: row.artist_key });
    }
    return exists;
  });

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
): Promise<{ idMap: IdMap; artistTrackPairs: ArtistTrackLink[]; count: number }> {
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
        artists: artists.map((artist) => ({
          normalizedName: artist.normalizedName,
          rawName: artist.display,
          candidateKey: artist.key,
        })),
        youtubeId,
      };
    })
    .filter(Boolean) as Array<{ row: any; artists: ArtistTrackLink['artists']; youtubeId: string }>;

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

  const artistTrackPairs: ArtistTrackLink[] = [];
  const seenPairs = new Set<string>();
  prepared.forEach((item) => {
    const trackId = idMap[item.youtubeId];
    if (!trackId || !item.artists.length) return;

    item.artists
      .map((artist) => ({
        normalizedName: normalizeArtistLookupName(artist.normalizedName),
        rawName: artist.rawName ?? artist.normalizedName,
        candidateKey: artist.candidateKey ?? null,
      }))
      .filter((artist) => Boolean(artist.normalizedName))
      .forEach((artist) => {
        const token = `${trackId}-${artist.normalizedName}`;
        if (seenPairs.has(token)) return;
        seenPairs.add(token);
        artistTrackPairs.push({ trackId, artists: [artist] });
      });
  });

  return { idMap, artistTrackPairs, count: rows.length };
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
  trackResult: { idMap: IdMap; artistTrackPairs: ArtistTrackLink[] },
  fallbackIdentifiers: string[],
  videoOrder: string[],
): ArtistTrackLink[] {
  const pairs: ArtistTrackLink[] = [];
  const seen = new Set<string>();
  const normalizedFallback = uniqueStrings(fallbackIdentifiers.map((value) => normalizeArtistLookupName(value)));

  const normalizeArtists = (artists: ArtistTrackLink['artists']): ArtistTrackLink['artists'] =>
    (artists || [])
      .map((artist) => ({
        normalizedName: normalizeArtistLookupName(artist.normalizedName),
        rawName: artist.rawName ?? artist.normalizedName,
        candidateKey: artist.candidateKey ?? null,
      }))
      .filter((artist) => Boolean(artist.normalizedName));

  const push = (trackId: string, artists: ArtistTrackLink['artists']) => {
    normalizeArtists(artists).forEach((artist) => {
      const token = `${trackId}-${artist.normalizedName}`;
      if (seen.has(token)) return;
      seen.add(token);
      pairs.push({ trackId, artists: [artist] });
    });
  };

  trackResult.artistTrackPairs.forEach((pair) => push(pair.trackId, pair.artists));

  const fallbackArtists = normalizedFallback.map((normalizedName) => ({ normalizedName }));

  videoOrder.forEach((youtubeId) => {
    const trackId = trackResult.idMap[normalize(youtubeId)];
    if (trackId) push(trackId, fallbackArtists);
  });

  Object.values(trackResult.idMap)
    .filter(Boolean)
    .forEach((trackId) => push(trackId, fallbackArtists));

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
    artistDescription: browse.description,
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
  trackResult: { idMap: IdMap; artistTrackPairs: ArtistTrackLink[] },
  fallbackArtistKeys: string[],
  videoOrder: string[],
): ArtistTrackLink[] {
  return buildArtistTrackPairs(trackResult, fallbackArtistKeys, videoOrder);
}
