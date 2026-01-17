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

  if (error) {
    throw new Error(`[artistQueries] ${label} failed: ${error.message}`);
  }

  if (!Array.isArray(data) || data.length === 0) return null;

  const payload = (data[0] as RawRow)?.playlists_by_title;
  if (!payload || typeof payload !== 'object') return null;

  return payload as DbSnapshotRow;
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
  const normalized = (artistKey || '').trim();
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
