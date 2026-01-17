import { getSupabaseAdmin } from '../../services/supabaseClient';

export type ArtistCompletionSnapshot = {
  artistKey: string;
  browseId: string;
  totalAlbums: number;
  completeAlbums: number;
  partialAlbums: number;
  unknownAlbums: number;
  expectedTracks: number;
  actualTracks: number;
  completionPercent: number | null;
  updatedAt: string | null;
  createdAt: string | null;
};

export type ArtistIngestCandidate = ArtistCompletionSnapshot;

export type ArtistChannelWriteResult = {
  artistKey: string;
  youtubeChannelId: string;
  existed: boolean;
  updated: boolean;
  previousChannelId: string | null;
};

type RawRow = { playlists_by_title?: any };

type DbSnapshotRow = {
  artist_key: string;
  browse_id: string;
  total_albums: number | null;
  complete_albums: number | null;
  partial_albums: number | null;
  unknown_albums: number | null;
  expected_tracks: number | null;
  actual_tracks: number | null;
  completion_percent: number | string | null;
  updated_at: string | null;
  created_at: string | null;
};

const ARTIST_LOCK_KEY = 723994;

function normalize(value: string | null | undefined): string {
  return typeof value === 'string' ? value.trim() : '';
}

function nowIso(): string {
  return new Date().toISOString();
}

function escapeLiteral(value: string): string {
  return value.replace(/'/g, "''");
}

function parseNumber(value: number | string | null | undefined): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number.parseFloat(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return 0;
}

function parsePercent(value: number | string | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number.parseFloat(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function mapSnapshot(row: DbSnapshotRow): ArtistCompletionSnapshot {
  return {
    artistKey: row.artist_key,
    browseId: row.browse_id,
    totalAlbums: parseNumber(row.total_albums),
    completeAlbums: parseNumber(row.complete_albums),
    partialAlbums: parseNumber(row.partial_albums),
    unknownAlbums: parseNumber(row.unknown_albums),
    expectedTracks: parseNumber(row.expected_tracks),
    actualTracks: parseNumber(row.actual_tracks),
    completionPercent: parsePercent(row.completion_percent),
    updatedAt: row.updated_at,
    createdAt: row.created_at,
  };
}

async function runJsonQuery(sql: string, label: string): Promise<DbSnapshotRow | null> {
  const client = getSupabaseAdmin();
  const { data, error } = await client.rpc('run_raw', { sql });

  if (error) throw new Error(`[artistQueries] ${label} failed: ${error.message}`);
  if (!Array.isArray(data) || data.length === 0) return null;

  const payload = (data[0] as RawRow)?.playlists_by_title;
  if (!payload || typeof payload !== 'object') return null;
  return payload as DbSnapshotRow;
}

async function runBooleanQuery(sql: string, label: string): Promise<boolean> {
  const client = getSupabaseAdmin();
  const { data, error } = await client.rpc('run_raw', { sql });

  if (error) throw new Error(`[artistQueries] ${label} failed: ${error.message}`);
  if (!Array.isArray(data) || data.length === 0) return false;

  const payload = (data[0] as RawRow)?.playlists_by_title;
  if (payload === null || payload === undefined) return false;
  if (typeof payload === 'boolean') return payload;
  if (typeof payload === 'object' && 'locked' in payload) {
    const candidate = (payload as any).locked;
    if (typeof candidate === 'boolean') return candidate;
  }
  return Boolean(payload);
}

function completionColumns(alias: string): string {
  return `
  ${alias}.artist_key,
  ${alias}.browse_id,
  ${alias}.updated_at,
  ${alias}.created_at,
  COALESCE(COUNT(alb.album_id), 0) AS total_albums,
  COALESCE(COUNT(*) FILTER (WHERE alb.track_count <= 0), 0) AS unknown_albums,
  COALESCE(COUNT(*) FILTER (WHERE alb.track_count > 0 AND alb.actual_tracks >= alb.track_count), 0) AS complete_albums,
  COALESCE(COUNT(*) FILTER (WHERE alb.track_count > 0 AND alb.actual_tracks < alb.track_count), 0) AS partial_albums,
  COALESCE(SUM(alb.track_count) FILTER (WHERE alb.track_count > 0), 0) AS expected_tracks,
  COALESCE(SUM(LEAST(alb.actual_tracks, alb.track_count)) FILTER (WHERE alb.track_count > 0), 0) AS actual_tracks
`;
}

function completionPercentExpression(): string {
  return `CASE WHEN c.expected_tracks > 0 THEN LEAST(100, ROUND((c.actual_tracks::numeric / c.expected_tracks::numeric) * 100)) ELSE NULL END AS completion_percent`;
}

export async function persistArtistChannelId(params: {
  artistKey: string;
  youtubeChannelId: string;
  displayName?: string;
}): Promise<ArtistChannelWriteResult> {
  const artistKey = normalize(params.artistKey);
  const youtubeChannelId = normalize(params.youtubeChannelId);
  const displayName = normalize(params.displayName || params.artistKey);
  if (!artistKey) throw new Error('[artistQueries] artistKey is required');
  if (!youtubeChannelId) throw new Error('[artistQueries] youtubeChannelId is required');

  const client = getSupabaseAdmin();
  const { data, error } = await client
    .from('artists')
    .select('artist_key, youtube_channel_id, display_name, normalized_name, artist')
    .eq('artist_key', artistKey)
    .limit(1);

  if (error) throw new Error(`[artistQueries] artist lookup failed: ${error.message}`);

  const existing = Array.isArray(data) && data.length > 0 ? data[0] : null;
  const previousChannelId = existing?.youtube_channel_id ?? null;

  if (!existing) {
    const normalizedName = displayName ? displayName.toLowerCase() : artistKey.toLowerCase();
    const insertRow = {
      artist_key: artistKey,
      artist: displayName || artistKey,
      display_name: displayName || artistKey,
      normalized_name: normalizedName,
      youtube_channel_id: youtubeChannelId,
      updated_at: nowIso(),
    };

    const { error: insertError } = await client.from('artists').upsert(insertRow, { onConflict: 'artist_key' });
    if (insertError) throw new Error(`[artistQueries] artist insert failed: ${insertError.message}`);

    return { artistKey, youtubeChannelId, existed: false, updated: true, previousChannelId };
  }

  if (previousChannelId === youtubeChannelId) {
    const { error: touchError } = await client.from('artists').update({ updated_at: nowIso() }).eq('artist_key', artistKey);
    if (touchError) throw new Error(`[artistQueries] artist touch failed: ${touchError.message}`);
    return { artistKey, youtubeChannelId, existed: true, updated: false, previousChannelId };
  }

  const updates: Record<string, any> = {
    youtube_channel_id: youtubeChannelId,
    updated_at: nowIso(),
  };

  if (!existing.display_name) updates.display_name = displayName || artistKey;
  if (!existing.normalized_name) updates.normalized_name = (displayName || artistKey).toLowerCase();
  if (!existing.artist) updates.artist = displayName || artistKey;

  const { error: updateError } = await client.from('artists').update(updates).eq('artist_key', artistKey);
  if (updateError) throw new Error(`[artistQueries] artist channel update failed: ${updateError.message}`);

  return { artistKey, youtubeChannelId, existed: true, updated: true, previousChannelId };
}

export async function tryAcquireBackgroundArtistLock(): Promise<boolean> {
  const sql = `
SELECT to_jsonb(pg_try_advisory_lock(${ARTIST_LOCK_KEY})) AS playlists_by_title, NULL::jsonb AS playlists_by_artist;
`;
  return runBooleanQuery(sql, 'tryAcquireBackgroundArtistLock');
}

export async function releaseBackgroundArtistLock(): Promise<void> {
  const sql = `
SELECT to_jsonb(pg_advisory_unlock(${ARTIST_LOCK_KEY})) AS playlists_by_title, NULL::jsonb AS playlists_by_artist;
`;
  await runBooleanQuery(sql, 'releaseBackgroundArtistLock');
}

export async function claimNextArtistForIngest(): Promise<ArtistIngestCandidate | null> {
  const sql = `
WITH ordered AS (
  SELECT a.artist_key, a.youtube_channel_id AS browse_id, a.updated_at, a.created_at
  FROM public.artists a
  WHERE a.youtube_channel_id IS NOT NULL
  ORDER BY a.updated_at ASC NULLS FIRST, a.created_at ASC
  LIMIT 200
),
album_status AS (
  SELECT
    aa.artist_key,
    al.id AS album_id,
    COALESCE(al.track_count, 0) AS track_count,
    (SELECT COUNT(*) FROM public.album_tracks at WHERE at.album_id = al.id) AS actual_tracks
  FROM public.artist_albums aa
  JOIN ordered o ON o.artist_key = aa.artist_key
  JOIN public.albums al ON al.id = aa.album_id
),
completion AS (
  SELECT
    ${completionColumns('o')}
  FROM ordered o
  LEFT JOIN album_status alb ON alb.artist_key = o.artist_key
  GROUP BY o.artist_key, o.browse_id, o.updated_at, o.created_at
),
eligible AS (
  SELECT
    c.*,
    ${completionPercentExpression()}
  FROM completion c
  WHERE NOT (
    c.total_albums > 0
    AND c.partial_albums = 0
    AND c.unknown_albums = 0
    AND c.complete_albums = c.total_albums
  )
  ORDER BY c.updated_at ASC NULLS FIRST, c.created_at ASC
  LIMIT 1
)
SELECT to_jsonb(e) AS playlists_by_title, NULL::jsonb AS playlists_by_artist
FROM eligible e
JOIN public.artists a ON a.artist_key = e.artist_key
FOR UPDATE OF a SKIP LOCKED;
`;

  const row = await runJsonQuery(sql, 'claimNextArtistForIngest');
  if (!row || !row.browse_id) return null;
  return mapSnapshot(row);
}

export async function getArtistCompletionSnapshot(artistKey: string): Promise<ArtistCompletionSnapshot | null> {
  const normalized = normalize(artistKey);
  if (!normalized) return null;

  const escaped = escapeLiteral(normalized);

  const sql = `
WITH target AS (
  SELECT a.artist_key, a.youtube_channel_id AS browse_id, a.updated_at, a.created_at
  FROM public.artists a
  WHERE a.artist_key = '${escaped}'
),
album_status AS (
  SELECT
    aa.artist_key,
    al.id AS album_id,
    COALESCE(al.track_count, 0) AS track_count,
    (SELECT COUNT(*) FROM public.album_tracks at WHERE at.album_id = al.id) AS actual_tracks
  FROM public.artist_albums aa
  JOIN target t ON t.artist_key = aa.artist_key
  JOIN public.albums al ON al.id = aa.album_id
),
completion AS (
  SELECT
    ${completionColumns('t')}
  FROM target t
  LEFT JOIN album_status alb ON alb.artist_key = t.artist_key
  GROUP BY t.artist_key, t.browse_id, t.updated_at, t.created_at
),
finalized AS (
  SELECT c.*, ${completionPercentExpression()} FROM completion c
)
SELECT to_jsonb(finalized) AS playlists_by_title, NULL::jsonb AS playlists_by_artist
FROM finalized;
`;

  const row = await runJsonQuery(sql, 'getArtistCompletionSnapshot');
  if (!row || !row.browse_id) return null;
  return mapSnapshot(row);
}
