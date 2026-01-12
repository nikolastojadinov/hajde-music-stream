import { canonicalArtistName, normalizeArtistKey } from '../utils/artistKey';
import type { ArtistBrowse, PlaylistBrowse } from './youtubeMusicClient';
import supabase from './supabaseClient';

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

function requireSupabase(): any {
  if (!supabase) {
    throw new Error('supabase_not_configured');
  }
  return supabase;
}

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

async function upsertArtists(inputs: ArtistInput[]): Promise<string[]> {
  if (!inputs.length) return [];
  const client = requireSupabase();
  const derived = uniqueBy(
    inputs
      .map((artist) => {
        const display = canonicalArtistName(artist.name);
        const key = normalizeArtistKey(display || artist.name);
        if (!key) return null;
        return {
          artist_key: key,
          display_name: display || artist.name,
          normalized_name: (display || artist.name).toLowerCase(),
          youtube_channel_id: normalize(artist.channelId) || null,
          thumbnails: artist.thumbnails || null,
          updated_at: NOW(),
        };
      })
      .filter(Boolean) as Array<Record<string, any>>,
    (row) => row.artist_key,
  );

  if (!derived.length) return [];

  const { error } = await client.from('artists').upsert(derived, { onConflict: 'artist_key' });
  if (error) throw new Error(error.message);
  return derived.map((row) => row.artist_key as string);
}

async function upsertAlbums(inputs: AlbumInput[]): Promise<IdMap> {
  if (!inputs.length) return {};
  const client = requireSupabase();
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

  if (!rows.length) return {};

  const { error } = await client.from('albums').upsert(rows, { onConflict: 'external_id' });
  if (error) throw new Error(error.message);

  const { data, error: selectError } = await client
    .from('albums')
    .select('id, external_id')
    .in('external_id', rows.map((r) => r.external_id));
  if (selectError) throw new Error(selectError.message);

  const map: IdMap = {};
  (data || []).forEach((row: any) => {
    if (row?.external_id && row?.id) map[row.external_id] = row.id;
  });
  return map;
}

async function upsertPlaylists(inputs: PlaylistInput[]): Promise<IdMap> {
  if (!inputs.length) return {};
  const client = requireSupabase();
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

  if (!rows.length) return {};

  const { error } = await client.from('playlists').upsert(rows, { onConflict: 'external_id' });
  if (error) throw new Error(error.message);

  const { data, error: selectError } = await client
    .from('playlists')
    .select('id, external_id')
    .in('external_id', rows.map((r) => r.external_id));
  if (selectError) throw new Error(selectError.message);

  const map: IdMap = {};
  (data || []).forEach((row: any) => {
    if (row?.external_id && row?.id) map[row.external_id] = row.id;
  });
  return map;
}

async function upsertTracks(inputs: TrackInput[], albumMap: IdMap): Promise<{ idMap: IdMap; artistTrackPairs: Array<{ trackId: string; artistKeys: string[] }> }> {
  if (!inputs.length) return { idMap: {}, artistTrackPairs: [] };
  const client = requireSupabase();
  const now = NOW();

  const prepared = inputs.map((t) => {
    const artists = deriveArtistKeys(t.artistNames);
    const primaryArtistKey = artists[0]?.key ?? null;
    const youtubeId = normalize(t.youtubeId);
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
        album_id: t.albumExternalId ? albumMap[normalize(t.albumExternalId)] ?? null : null,
        sync_status: 'active',
        last_synced_at: now,
        last_updated_at: now,
        is_video: Boolean(t.isVideo),
        source: t.source ?? null,
        is_explicit: t.isExplicit ?? null,
      },
      artistKeys: artists.map((a) => a.key),
      youtubeId,
    };
  });

  const rows = uniqueBy(prepared.map((p) => p.row), (row) => row.youtube_id).filter((row) => Boolean(row.youtube_id));
  if (!rows.length) return { idMap: {}, artistTrackPairs: [] };

  const { error } = await client.from('tracks').upsert(rows, { onConflict: 'youtube_id' });
  if (error) throw new Error(error.message);

  const { data, error: selectError } = await client
    .from('tracks')
    .select('id, youtube_id')
    .in('youtube_id', rows.map((r) => r.youtube_id));
  if (selectError) throw new Error(selectError.message);

  const idMap: IdMap = {};
  (data || []).forEach((row: any) => {
    if (row?.youtube_id && row?.id) idMap[row.youtube_id] = row.id;
  });

  const artistTrackPairs: Array<{ trackId: string; artistKeys: string[] }> = [];
  prepared.forEach((item) => {
    const trackId = idMap[item.youtubeId];
    if (!trackId || !item.artistKeys.length) return;
    artistTrackPairs.push({ trackId, artistKeys: item.artistKeys });
  });

  return { idMap, artistTrackPairs };
}

async function linkArtistTracks(pairs: Array<{ trackId: string; artistKeys: string[] }>): Promise<void> {
  if (!pairs.length) return;
  const client = requireSupabase();
  const rows: Array<{ artist_key: string; track_id: string }> = [];
  pairs.forEach((pair) => {
    pair.artistKeys.forEach((artistKey) => {
      rows.push({ artist_key: artistKey, track_id: pair.trackId });
    });
  });
  if (!rows.length) return;
  const { error } = await client.from('artist_tracks').upsert(rows, { onConflict: 'artist_key,track_id' });
  if (error) throw new Error(error.message);
}

async function linkArtistAlbums(albumIds: string[], artistKeys: string[]): Promise<void> {
  if (!albumIds.length || !artistKeys.length) return;
  const client = requireSupabase();
  const rows: Array<{ artist_key: string; album_id: string }> = [];
  albumIds.forEach((albumId) => {
    artistKeys.forEach((artistKey) => rows.push({ artist_key: artistKey, album_id: albumId }));
  });
  const { error } = await client.from('artist_albums').upsert(rows, { onConflict: 'artist_key,album_id' });
  if (error) throw new Error(error.message);
}

async function linkAlbumTracks(albumId: string, trackIds: string[]): Promise<void> {
  if (!albumId || !trackIds.length) return;
  const client = requireSupabase();
  const rows = trackIds.map((trackId, index) => ({ album_id: albumId, track_id: trackId, position: index + 1 }));
  const { error } = await client.from('album_tracks').upsert(rows, { onConflict: 'album_id,track_id' });
  if (error) throw new Error(error.message);
}

async function linkPlaylistTracks(playlistId: string, trackIds: string[]): Promise<void> {
  if (!playlistId || !trackIds.length) return;
  const client = requireSupabase();
  const rows = trackIds.map((trackId, index) => ({ playlist_id: playlistId, track_id: trackId, position: index + 1 }));
  const { error } = await client.from('playlist_tracks').upsert(rows, { onConflict: 'playlist_id,track_id' });
  if (error) throw new Error(error.message);
}

function parseAlbumReleaseDate(subtitle: string | null | undefined): string | null {
  const yearMatch = normalize(subtitle).match(/(19|20)\d{2}/);
  if (!yearMatch) return null;
  return `${yearMatch[0]}-01-01`;
}

export async function ingestArtistBrowse(browse: ArtistBrowse): Promise<void> {
  try {
    const artistName = browse.artist.name;
    const artistKey = normalizeArtistKey(artistName) || normalize(browse.artist.channelId);
    const artistInputs: ArtistInput[] = artistKey
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
      artistNames: [artistName],
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
      artistKeys: artistKey ? [artistKey] : [],
    }));

    const playlistInputs: PlaylistInput[] = (browse.playlists || []).map((pl) => ({
      externalId: pl.id,
      title: pl.title,
      thumbnailUrl: pl.imageUrl ?? null,
      channelId: browse.artist.channelId ?? null,
    }));

    const artistKeys = await upsertArtists(artistInputs);
    const albumMap = await upsertAlbums(albumInputs);
    await upsertPlaylists(playlistInputs);
    const { idMap: trackMap, artistTrackPairs } = await upsertTracks(topSongTracks, albumMap);

    await linkArtistTracks(
      artistTrackPairs.map((pair) => ({ trackId: pair.trackId, artistKeys: artistKeys.length ? artistKeys : pair.artistKeys })),
    );
    if (artistKeys.length && Object.values(albumMap).length) {
      await linkArtistAlbums(Object.values(albumMap), artistKeys);
    }
  } catch (err) {
    console.error('[ingestArtistBrowse] failed', err instanceof Error ? err.message : err);
  }
}

export async function ingestTrackSelection(selection: TrackSelectionInput): Promise<void> {
  if (selection.type === 'episode') return;
  if (!selection.youtubeId || !VIDEO_ID_REGEX.test(selection.youtubeId)) return;

  try {
    const artists = splitArtists(selection.subtitle || '') || [];
    const artistKeys = await upsertArtists(artists.map((name) => ({ name })));
    const { idMap, artistTrackPairs } = await upsertTracks(
      [
        {
          youtubeId: selection.youtubeId,
          title: selection.title || selection.subtitle || 'Untitled',
          artistNames: artists,
          thumbnailUrl: selection.imageUrl ?? null,
          isVideo: selection.type === 'video',
          source: selection.type,
        },
      ],
      {},
    );

    if (Object.keys(idMap).length) {
      const pairs = artistTrackPairs.length
        ? artistTrackPairs
        : Object.values(idMap).map((trackId) => ({ trackId, artistKeys }));
      await linkArtistTracks(pairs);
    }
  } catch (err) {
    console.error('[ingestTrackSelection] failed', err instanceof Error ? err.message : err);
  }
}

export async function ingestPlaylistOrAlbum(payload: PlaylistOrAlbumIngest): Promise<void> {
  if (!payload?.browseId) return;
  if (!Array.isArray(payload.tracks) || payload.tracks.length === 0) return;

  try {
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

    const artistKeys = await upsertArtists(allArtistNames.map((name) => ({ name })));

    if (payload.kind === 'album' && artistKeys.length === 0) {
      const fallbackName = normalize(payload.subtitle) || normalize(payload.title) || payload.browseId || 'Unknown artist';
      const fallbackKeys = await upsertArtists([{ name: fallbackName }]);
      artistKeys.push(...fallbackKeys);
    }

    const albumMap = payload.kind === 'album'
      ? await upsertAlbums([
          {
            externalId: browseKey,
            title,
            thumbnailUrl: payload.thumbnailUrl ?? null,
            releaseDate: parseAlbumReleaseDate(payload.subtitle),
            albumType: null,
            artistKeys,
          },
        ])
      : {};

    const playlistMap = payload.kind === 'playlist'
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
      : {};

    const { idMap: trackMap, artistTrackPairs } = await upsertTracks(trackInputs, albumMap);

    if (payload.kind === 'album' && Object.keys(albumMap).length) {
      const albumId = albumMap[browseKey];
      if (albumId) {
        await linkAlbumTracks(
          albumId,
          payload.tracks
            .map((t) => normalize(t.videoId))
            .map((id) => trackMap[id])
            .filter(Boolean),
        );
        if (artistKeys.length) {
          await linkArtistAlbums([albumId], artistKeys);
        }
      }
    }

    if (payload.kind === 'playlist' && Object.keys(playlistMap).length) {
      const playlistId = playlistMap[browseKey];
      if (playlistId) {
        await linkPlaylistTracks(
          playlistId,
          payload.tracks
            .map((t) => normalize(t.videoId))
            .map((id) => trackMap[id])
            .filter(Boolean),
        );
      }
    }

    const mergedPairs: Array<{ trackId: string; artistKeys: string[] }> = artistTrackPairs.map((pair) => ({
      trackId: pair.trackId,
      artistKeys: pair.artistKeys.length ? pair.artistKeys : artistKeys,
    }));

    const fallbackPairs: Array<{ trackId: string; artistKeys: string[] }> = [];
    if (!mergedPairs.length && artistKeys.length) {
      Object.values(trackMap)
        .filter(Boolean)
        .forEach((trackId) => fallbackPairs.push({ trackId, artistKeys }));
    }

    await linkArtistTracks([...mergedPairs, ...fallbackPairs]);
  } catch (err) {
    console.error('[ingestPlaylistOrAlbum] failed', err instanceof Error ? err.message : err);
  }
}
