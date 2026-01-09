import { DateTime } from 'luxon';
import type { SupabaseClient } from '@supabase/supabase-js';

import env from '../environments';
import supabase from './supabaseClient';

const SECTION_KEY = 'trending_now';
const DEFAULT_MAX_ITEMS = 18;
const DEFAULT_FETCH_LIMIT = 48;
const DEFAULT_VALIDITY_DAYS = 8;

export type TrendingSnapshotItem = {
  type: 'playlist';
  id: string;
  external_id: string | null;
  title: string;
  subtitle: string;
  imageUrl: string | null;
  metrics: {
    views_7d: number;
    trend_score: number;
  };
};

export type TrendingSnapshot = {
  section: 'trending_now';
  generated_at: string;
  refresh_policy: {
    type: 'interval';
    interval: 'weekly';
    preferred_window: '02:00-04:00 UTC';
  };
  items: TrendingSnapshotItem[];
};

export type TrendingRefreshResult = {
  snapshot: TrendingSnapshot;
  persisted: boolean;
  runId: string | null;
};

type CandidateRow = {
  playlist_id: string;
  external_id?: string | null;
  title?: string | null;
  cover_url?: string | null;
  image_url?: string | null;
  view_count?: number | null;
  quality_score?: number | null;
  validated?: boolean | null;
  last_refreshed_on?: string | null;
  dedup_views_7d?: number | null;
  playlist_views_7d?: number | null;
  recent_viewed_at?: string | null;
};

const REFRESH_POLICY = {
  type: 'interval' as const,
  interval: 'weekly' as const,
  preferred_window: '02:00-04:00 UTC' as const,
};

function requireSupabase(): SupabaseClient {
  if (!supabase) {
    throw new Error('Supabase client is not configured');
  }
  return supabase;
}

function clampNumber(value: number, min: number, max: number): number {
  if (Number.isNaN(value)) return min;
  return Math.max(min, Math.min(max, value));
}

function toNumber(value: unknown, fallback = 0): number {
  const num = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(num) ? num : fallback;
}

function compact(value: number): string {
  return new Intl.NumberFormat('en', {
    notation: 'compact',
    maximumFractionDigits: 1,
  }).format(value);
}

function parseDate(value: string | null | undefined): DateTime | null {
  if (!value) return null;
  const dt = DateTime.fromISO(value, { zone: 'utc' });
  return dt.isValid ? dt : null;
}

function computeTrendScore(row: CandidateRow, views7d: number, now: DateTime): number {
  const evergreen = Math.log1p(Math.max(0, toNumber(row.view_count, 0)));
  const qualityRaw = clampNumber(toNumber(row.quality_score, 0), -1000, 1000);
  const quality = qualityRaw >= 0 ? qualityRaw : 0;
  const velocity = Math.sqrt(Math.max(0, views7d));

  const refreshedAt = parseDate(row.last_refreshed_on);
  const daysSinceRefresh = refreshedAt ? Math.max(0, now.diff(refreshedAt, 'days').days) : 90;
  const freshnessBoost = Math.max(0, 24 - Math.min(daysSinceRefresh, 120) * 0.2);

  const recentAt = parseDate(row.recent_viewed_at ?? undefined);
  const daysSinceRecent = recentAt ? Math.max(0, now.diff(recentAt, 'days').days) : null;
  const recencyBoost = daysSinceRecent === null ? 0 : Math.max(0, 14 - Math.min(daysSinceRecent, 28)) * 0.4;

  const validationBoost = row.validated ? 4 : 0;

  const score =
    views7d * 1.25 +
    velocity * 3.25 +
    evergreen * 1.85 +
    quality * 2.6 +
    freshnessBoost +
    recencyBoost +
    validationBoost;

  const normalized = Number.parseFloat(score.toFixed(4));
  return Number.isFinite(normalized) ? normalized : 0;
}

function buildSubtitle(views7d: number, lifetimeViews: number | null): string {
  if (views7d > 0) return `${compact(views7d)} views this week`;
  if (lifetimeViews && lifetimeViews > 0) return `${compact(lifetimeViews)} lifetime views`;
  return 'Curated playlist';
}

function normalizeImage(row: CandidateRow): string | null {
  return (row.cover_url || row.image_url || null) ?? null;
}

function sanitizeTitle(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  return trimmed.length ? trimmed : null;
}

async function ensureSectionRow(client: SupabaseClient): Promise<void> {
  const { error } = await client
    .from('home_sections')
    .upsert({
      key: SECTION_KEY,
      title: 'Trending Now',
      is_active: true,
      refresh_policy: REFRESH_POLICY,
    }, { onConflict: 'key' });

  if (error) {
    throw new Error(`Failed to ensure home_sections row: ${error.message}`);
  }
}

async function fetchCandidates(limit = DEFAULT_FETCH_LIMIT): Promise<CandidateRow[]> {
  const client = requireSupabase();
  const { data, error } = await client.rpc('trending_now_candidates', { limit_count: limit });
  if (error) {
    throw new Error(`Failed to load trending candidates: ${error.message}`);
  }
  return (data as CandidateRow[]) || [];
}

function buildSnapshotFromCandidates(rows: CandidateRow[], generatedAt: DateTime): TrendingSnapshot {
  const now = generatedAt;
  const items: TrendingSnapshotItem[] = [];
  const seen = new Set<string>();

  for (const row of rows) {
    if (!row.playlist_id) continue;
    if (seen.has(row.playlist_id)) continue;
    seen.add(row.playlist_id);
    const title = sanitizeTitle(row.title ?? undefined);
    if (!title) continue;

    const views7d = Math.max(
      0,
      toNumber(row.dedup_views_7d, 0),
      toNumber(row.playlist_views_7d, 0)
    );

    const trendScore = computeTrendScore(row, views7d, now);

    items.push({
      type: 'playlist',
      id: row.playlist_id,
      external_id: row.external_id ?? null,
      title,
      subtitle: buildSubtitle(views7d, row.view_count ?? null),
      imageUrl: normalizeImage(row),
      metrics: {
        views_7d: Math.max(0, Math.round(views7d)),
        trend_score: trendScore,
      },
    });
  }

  items.sort((a, b) => b.metrics.trend_score - a.metrics.trend_score);

  const trimmed = items.slice(0, DEFAULT_MAX_ITEMS);

  const generatedAtIso = now.toISO() ?? new Date().toISOString();

  return {
    section: 'trending_now',
    generated_at: generatedAtIso,
    refresh_policy: REFRESH_POLICY,
    items: trimmed,
  };
}

async function expireOldSnapshots(client: SupabaseClient, generatedAtIso: string): Promise<void> {
  const { error } = await client
    .from('home_section_snapshots')
    .update({ valid_until: generatedAtIso })
    .eq('section_key', SECTION_KEY)
    .or(`valid_until.is.null,valid_until.gt.${generatedAtIso}`);

  if (error) {
    throw new Error(`Failed to expire old snapshots: ${error.message}`);
  }
}

async function insertSnapshot(client: SupabaseClient, snapshot: TrendingSnapshot, generatedAt: DateTime): Promise<void> {
  const validUntil = generatedAt.plus({ days: DEFAULT_VALIDITY_DAYS }).toISO() ?? null;
  const { error } = await client.from('home_section_snapshots').insert({
    section_key: SECTION_KEY,
    payload: snapshot,
    generated_at: snapshot.generated_at,
    valid_until: validUntil,
  });

  if (error) {
    throw new Error(`Failed to insert snapshot: ${error.message}`);
  }
}

async function startRun(client: SupabaseClient, note?: string): Promise<string | null> {
  const { data, error } = await client
    .from('home_section_runs')
    .insert({
      section_key: SECTION_KEY,
      status: 'running',
      notes: note ?? null,
    })
    .select('id')
    .maybeSingle();

  if (error) {
    console.warn('[TrendingNow] Failed to record run start', error.message);
    return null;
  }
  return (data as any)?.id ?? null;
}

async function finishRun(client: SupabaseClient, runId: string | null, status: 'success' | 'error', note?: string, errorJson?: Record<string, unknown>) {
  if (!runId) return;
  const payload: Record<string, unknown> = {
    status,
    finished_at: new Date().toISOString(),
  };
  if (note) payload.notes = note;
  if (status === 'error' && errorJson) payload.error = errorJson;

  const { error } = await client.from('home_section_runs').update(payload).eq('id', runId);
  if (error) {
    console.warn('[TrendingNow] Failed to finish run', { runId, status, error: error.message });
  }
}

export async function refreshTrendingNowSnapshot(note?: string): Promise<TrendingRefreshResult> {
  const client = requireSupabase();
  await ensureSectionRow(client);

  const runId = await startRun(client, note ?? 'scheduled refresh');
  const generatedAt = DateTime.utc();

  try {
    const candidates = await fetchCandidates();
    const snapshot = buildSnapshotFromCandidates(candidates, generatedAt);

    await expireOldSnapshots(client, snapshot.generated_at);
    await insertSnapshot(client, snapshot, generatedAt);
    await finishRun(client, runId, 'success', `items=${snapshot.items.length}`);

    return { snapshot, persisted: true, runId };
  } catch (err: any) {
    const errorJson = {
      message: err?.message || 'unknown_error',
      detail: err?.stack || null,
    };
    await finishRun(client, runId, 'error', err?.message, errorJson);
    throw err;
  }
}

export async function getTrendingNowSnapshot(): Promise<TrendingSnapshot | null> {
  if (!supabase) return null;

  const nowIso = new Date().toISOString();

  const { data, error } = await supabase
    .from('home_section_snapshots')
    .select('payload, generated_at, valid_until')
    .eq('section_key', SECTION_KEY)
    .or(`valid_until.is.null,valid_until.gt.${nowIso}`)
    .order('generated_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    console.error('[TrendingNow] Failed to read snapshot', error.message);
    return null;
  }

  const payload = (data as any)?.payload as TrendingSnapshot | undefined;
  if (!payload) return null;
  return payload;
}

export async function ensureTrendingWarmStart(): Promise<void> {
  if (!env.enable_run_jobs) return;
  const existing = await getTrendingNowSnapshot();
  if (existing) return;

  try {
    await refreshTrendingNowSnapshot('bootstrap');
  } catch (err: any) {
    console.warn('[TrendingNow] Warm-start refresh failed', err?.message || err);
  }
}

export { SECTION_KEY };
