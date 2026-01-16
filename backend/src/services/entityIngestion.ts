import { canonicalArtistName, normalizeArtistKey } from '../utils/artistKey';
import type { ArtistBrowse, PlaylistBrowse } from './youtubeMusicClient';
import { getSupabaseAdmin } from './supabaseClient';

const VIDEO_ID_REGEX = /^[A-Za-z0-9_-]{11}$/;
const NOW = () => new Date().toISOString();

export type TrackSelectionInput = {
  type: 'song' | 'video' | 'episode';
  youtubeId: string;
  title?: string;
  subtitle?: string | null;
  imageUrl?: string | null;
};

export type PlaylistIngestKind = 'playlist' | 'album';

type ArtistInput = { name: string; channelId?: string | null; thumbnails?: { avatar?: string | null; banner?: string | null } };
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

type PlaylistOrAlbumIngest = {
  browseId: string;
  kind: PlaylistIngestKind;
  title?: string | null;
  subtitle?: string | null;
  thumbnailUrl?: string | null;
  tracks: PlaylistBrowse['tracks'];
};

function normalize(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function toSeconds(raw: string | null | undefined): number | null {
  const value = normalize(raw);
  if (!value) return null;
  if (/^\d+$/.test(value)) return Number.parseInt(value, 10);
  const parts = value.split(':').map((p) => Number.parseInt(p, 10)).filter((n) => Number.isFinite(n));
  if (parts.length === 0) return null;
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

async function upsertArtists(inputs: ArtistInput[]): Promise<{ keys: string[]; count: number }> {
  if (!inputs.length) return { keys: [], count: 0 };
  const client = getSupabaseAdmin();

  const rows = uniqueBy(
    inputs
      .map((artist) => {
        const display = canonicalArtistName(artist.name);
        const key = normalizeArtistKey(display || artist.name);
        const artistValue = normalize(display || artist.name || key);
        if (!key || !artistValue) return null;
        return {
          artist: artistValue,
          artist_key: key,
          display_name: display || artist.name,
          normalized_name: artistValue.toLowerCase(),
          youtube_channel_id: normalize(artist.channelId) || null,
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

async function upsertTracks(inputs: TrackInput[], albumMap: IdMap): Promise<{ idMap: IdMap; artistTrackPairs: Array<{ trackId: string; artistKeys: string[] }>; count: number }> {
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
    const uniqueKeys = Array.from(new Set(item.artistKeys));
    uniqueKeys.forEach((artistKey) => {
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

export async function ingestArtistBrowse(browse: ArtistBrowse, opts?: { allowArtistWrite?: boolean }): Promise<void> {
  const allowArtistWrite = opts?.allowArtistWrite !== false;
  const artistName = browse.artist.name;
  const artistKey = normalizeArtistKey(artistName) || normalize(browse.artist.channelId);

  const artistInputs: ArtistInput[] = allowArtistWrite && artistKey
    ? [
        {
          name: artistName,
          channelId: browse.artist.channelId,
          thumbnails: { avatar: browse.artist.thumbnailUrl, banner: browse.artist.bannerUrl },
        },
      ]
    : [];

  const topSongTracks: TrackInput[] = (browse.topSongs || []).map((song) => ({
    youtubeId: song.id,
    title: song.title,
    artistNames: allowArtistWrite ? [artistName] : [],
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
    artistKeys: allowArtistWrite && artistKey ? [artistKey] : [],
  }));

  const playlistInputs: PlaylistInput[] = (browse.playlists || []).map((pl) => ({
    externalId: pl.id,
    title: pl.title,
    thumbnailUrl: pl.imageUrl ?? null,
    channelId: browse.artist.channelId ?? null,
  }));

  const artistResult = allowArtistWrite ? await upsertArtists(artistInputs) : { keys: [], count: 0 };
  const albumResult = await upsertAlbums(albumInputs);
  const playlistResult = await upsertPlaylists(playlistInputs);
  const trackResult = await upsertTracks(topSongTracks, albumResult.map);

  const artistTrackPairs = allowArtistWrite
    ? trackResult.artistTrackPairs.map((pair) => ({ trackId: pair.trackId, artistKeys: artistResult.keys.length ? artistResult.keys : pair.artistKeys }))
    : [];

  const artistTrackCount = await linkArtistTracks(artistTrackPairs);
  const artistAlbumCount = allowArtistWrite && artistResult.keys.length && Object.values(albumResult.map).length
    ? await linkArtistAlbums(Object.values(albumResult.map), artistResult.keys)
    : 0;

  console.info('[ingestArtistBrowse] ok', {
    artists: artistResult.count,
    albums: albumResult.count,
    playlists: playlistResult.count,
    tracks: trackResult.count,
    artist_tracks: artistTrackCount,
    artist_albums: artistAlbumCount,
  });
}

export async function ingestTrackSelection(selection: TrackSelectionInput, opts?: { allowArtistWrite?: boolean }): Promise<void> {
  const allowArtistWrite = opts?.allowArtistWrite !== false;
  if (selection.type === 'episode') return;
  if (!selection.youtubeId || !VIDEO_ID_REGEX.test(selection.youtubeId)) return;

  const artists = allowArtistWrite ? splitArtists(selection.subtitle || '') || [] : [];
  const artistResult = allowArtistWrite ? await upsertArtists(artists.map((name) => ({ name }))) : { keys: [], count: 0 };
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
    const pairs = trackResult.artistTrackPairs.length
      ? trackResult.artistTrackPairs
      : Object.values(trackResult.idMap).map((trackId) => ({ trackId, artistKeys: artistResult.keys }));
    await linkArtistTracks(pairs);
  }

  console.info('[ingestTrackSelection] ok', {
    artists: artistResult.count,
    tracks: trackResult.count,
  });
}

export async function ingestPlaylistOrAlbum(payload: PlaylistOrAlbumIngest): Promise<void> {
  if (!payload?.browseId) return;
  if (!Array.isArray(payload.tracks) || payload.tracks.length === 0) return;

  const browseKey = normalize(payload.browseId);
  const title = normalize(payload.title) || payload.browseId;
  const artistsFromSubtitle = splitArtists(payload.subtitle);
  const trackInputs: TrackInput[] = payload.tracks.map((t) => ({
    youtubeId: normalize(t.videoId),
    title: normalize(t.title) || 'Untitled',
    artistNames: splitArtists(t.artist),
    durationSeconds: toSeconds(t.duration),
    thumbnailUrl: t.thumbnail ?? null,
    albumExternalId: payload.kind === 'album' ? payload.browseId : null,
    isVideo: true,
    source: payload.kind,
  }));

  const allArtistNames = Array.from(
    new Set<string>([
      ...artistsFromSubtitle,
      ...trackInputs.flatMap((t) => t.artistNames),
    ]),
  );

  const artistResult = await upsertArtists(allArtistNames.map((name) => ({ name })));

  if (payload.kind === 'album' && artistResult.keys.length === 0) {
    const fallbackName = normalize(payload.subtitle) || normalize(payload.title) || payload.browseId || 'Unknown artist';
    const fallbackKeys = await upsertArtists([{ name: fallbackName }]);
    artistResult.keys.push(...fallbackKeys.keys);
  }

  const albumResult = payload.kind === 'album'
    ? await upsertAlbums([
        {
          externalId: browseKey,
          title,
          thumbnailUrl: payload.thumbnailUrl ?? null,
          releaseDate: parseAlbumReleaseDate(payload.subtitle),
          albumType: null,
          artistKeys: artistResult.keys,
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
          channelId: null,
          itemCount: payload.tracks.length,
        },
      ])
    : { map: {}, count: 0 };

  const trackResult = await upsertTracks(trackInputs, albumResult.map);

  console.info('[tracks] upsert ok', { count: trackResult.count });

  let albumTrackCount = 0;
  let artistAlbumCount = 0;
  let playlistTrackCount = 0;
  if (payload.kind === 'album' && Object.keys(albumResult.map).length) {
    const albumId = albumResult.map[browseKey];
    if (albumId) {
      albumTrackCount = await linkAlbumTracks(
        albumId,
        payload.tracks
          .map((t) => normalize(t.videoId))
          .map((id) => trackResult.idMap[id])
          .filter(Boolean),
      );
      if (artistResult.keys.length) {
        artistAlbumCount = await linkArtistAlbums([albumId], artistResult.keys);
      }
    }
  }

  if (payload.kind === 'playlist' && Object.keys(playlistResult.map).length) {
    const playlistId = playlistResult.map[browseKey];
    if (playlistId) {
      playlistTrackCount = await linkPlaylistTracks(
        playlistId,
        payload.tracks
          .map((t) => normalize(t.videoId))
          .map((id) => trackResult.idMap[id])
          .filter(Boolean),
      );
    }
  }

  const mergedPairs: Array<{ trackId: string; artistKeys: string[] }> = trackResult.artistTrackPairs.map((pair) => ({
    trackId: pair.trackId,
    artistKeys: pair.artistKeys.length ? pair.artistKeys : artistResult.keys,
  }));

  const fallbackPairs: Array<{ trackId: string; artistKeys: string[] }> = [];
  if (!mergedPairs.length && artistResult.keys.length) {
    Object.values(trackResult.idMap)
      .filter(Boolean)
      .forEach((trackId) => fallbackPairs.push({ trackId, artistKeys: artistResult.keys }));
  }

  const artistTrackCount = await linkArtistTracks([...mergedPairs, ...fallbackPairs]);

  console.info('[relations] album_tracks', { count: albumTrackCount });
  console.info('[relations] playlist_tracks', { count: playlistTrackCount });

  console.info('[ingestPlaylistOrAlbum] ok', {
    artists: artistResult.count,
    albums: albumResult.count,
    playlists: playlistResult.count,
    tracks: trackResult.count,
    album_tracks: albumTrackCount,
    playlist_tracks: playlistTrackCount,
    artist_tracks: artistTrackCount,
    artist_albums: artistAlbumCount,
  });
}
