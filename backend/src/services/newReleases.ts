import { DateTime } from 'luxon';
import type { SupabaseClient } from '@supabase/supabase-js';

import env from '../environments';
import supabase from './supabaseClient';

const SECTION_KEY = 'new_releases';
const DEFAULT_MAX_ITEMS = 18;
const DEFAULT_FETCH_LIMIT = 60;
const DEFAULT_VALIDITY_DAYS = 30;

export type NewReleasesSnapshotItem = {
  type: 'playlist';
  id: string;
  external_id: string | null;
  title: string;
  subtitle: string;
  imageUrl: string | null;
  metrics: {
    views_total: number;
    views_7d: number;
    release_at: string | null;
    track_count: number | null;
  };
};

export type NewReleasesSnapshot = {
  section: 'new_releases';
  generated_at: string;
  refresh_policy: {
    type: 'interval';
    interval: 'weekly';
    preferred_window: '02:00-04:00 UTC';
  };
  items: NewReleasesSnapshotItem[];
};

export type NewReleasesRefreshResult = {
  snapshot: NewReleasesSnapshot;
  persisted: boolean;
  runId: string | null;
};

type CandidateRow = {
  playlist_id: string;
  external_id?: string | null;
  title?: string | null;
  cover_url?: string | null;
  image_url?: string | null;
  release_at?: string | null;
  views_count?: number | null;
  playlist_views_total?: number | null;
  playlist_views_7d?: number | null;
  track_count?: number | null;
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

function toNumber(value: unknown, fallback = 0): number {
  const num = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(num) ? num : fallback;
}

function sanitizeTitle(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  return trimmed.length ? trimmed : null;
}

function formatRelease(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const dt = DateTime.fromISO(iso, { zone: 'utc' });
  if (!dt.isValid) return null;
  return dt.toISODate();
}

async function ensureSectionRow(client: SupabaseClient): Promise<void> {
  const { error } = await client
    .from('home_sections')
    .upsert({
      key: SECTION_KEY,
      title: 'New Releases',
      is_active: true,
      refresh_policy: REFRESH_POLICY,
    }, { onConflict: 'key' });

  if (error) {
    throw new Error(`Failed to ensure home_sections row (new_releases): ${error.message}`);
  }
}

async function refreshCandidates(client: SupabaseClient, limit = DEFAULT_FETCH_LIMIT): Promise<void> {
  const { error } = await client.rpc('refresh_new_releases_home_candidates', { max_limit: limit });
  if (error) {
    throw new Error(`Failed to refresh new_releases candidates: ${error.message}`);
  }
}

async function fetchCandidates(limit = DEFAULT_FETCH_LIMIT): Promise<CandidateRow[]> {
  const client = requireSupabase();
  const { data, error } = await client
    .from('new_releases_home_candidates')
    .select('playlist_id, external_id, title, cover_url, image_url, release_at, views_count, playlist_views_total, playlist_views_7d')
    .order('release_at', { ascending: false })
    .order('views_count', { ascending: false })
    .limit(limit);

  if (error) {
    throw new Error(`Failed to load new_releases candidates: ${error.message}`);
  }

  return (data as CandidateRow[]) || [];
}

function buildSubtitle(releaseIso: string | null, viewsTotal: number): string {
  const dateLabel = releaseIso ? `Released ${releaseIso}` : null;
  if (dateLabel) return dateLabel;
  if (viewsTotal > 0) return `${viewsTotal.toLocaleString()} views`;
  return 'New playlist';
}

function normalizeImage(row: CandidateRow): string | null {
  return (row.cover_url || row.image_url || null) ?? null;
}

function readTrackCount(row: CandidateRow): number | null {
  const raw = (row as any)?.track_count ?? null;
  if (raw === null || raw === undefined) return null;
  const num = Number(raw);
  if (!Number.isFinite(num)) return null;
  if (num <= 0) return 0;
  return Math.round(num);
}

function buildSnapshotFromCandidates(rows: CandidateRow[], generatedAt: DateTime): NewReleasesSnapshot {
  const items: NewReleasesSnapshotItem[] = [];
  const seen = new Set<string>();

  for (const row of rows) {
    if (!row.playlist_id) continue;
    if (seen.has(row.playlist_id)) continue;
    seen.add(row.playlist_id);

    const title = sanitizeTitle(row.title ?? undefined);
    if (!title) continue;

    const viewsTotal = Math.max(0, toNumber(row.views_count, 0), toNumber(row.playlist_views_total, 0));
    const views7d = Math.max(0, toNumber(row.playlist_views_7d, 0));
    const releaseIso = formatRelease(row.release_at ?? null);
    const trackCount = readTrackCount(row);
    if (trackCount === 0) continue;

    items.push({
      type: 'playlist',
      id: row.playlist_id,
      external_id: row.external_id ?? null,
      title,
      subtitle: buildSubtitle(releaseIso, viewsTotal),
      imageUrl: normalizeImage(row),
      metrics: {
        views_total: Math.round(viewsTotal),
        views_7d: Math.round(views7d),
        release_at: releaseIso,
        track_count: trackCount,
      },
    });
  }

  items.sort((a, b) => {
    const aRel = a.metrics.release_at ? DateTime.fromISO(a.metrics.release_at) : null;
    const bRel = b.metrics.release_at ? DateTime.fromISO(b.metrics.release_at) : null;
    if (aRel && bRel) {
      const diff = bRel.toMillis() - aRel.toMillis();
      if (diff !== 0) return diff;
    } else if (aRel && !bRel) {
      return -1;
    } else if (!aRel && bRel) {
      return 1;
    }
    return b.metrics.views_total - a.metrics.views_total;
  });

  const trimmed = items.slice(0, DEFAULT_MAX_ITEMS);
  const generatedAtIso = generatedAt.toISO() ?? new Date().toISOString();

  return {
    section: 'new_releases',
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
    throw new Error(`Failed to expire old new_releases snapshots: ${error.message}`);
  }
}

async function insertSnapshot(client: SupabaseClient, snapshot: NewReleasesSnapshot, generatedAt: DateTime): Promise<void> {
  const validUntil = generatedAt.plus({ days: DEFAULT_VALIDITY_DAYS }).toISO() ?? null;
  const { error } = await client.from('home_section_snapshots').insert({
    section_key: SECTION_KEY,
    payload: snapshot,
    generated_at: snapshot.generated_at,
    valid_until: validUntil,
  });

  if (error) {
    throw new Error(`Failed to insert new_releases snapshot: ${error.message}`);
  }
}

async function startRun(client: SupabaseClient, note?: string): Promise<string | null> {
  const { data, error } = await client
    .from('home_section_runs')
    .insert({ section_key: SECTION_KEY, status: 'running', notes: note ?? null })
    .select('id')
    .maybeSingle();

  if (error) {
    console.warn('[NewReleases] Failed to record run start', error.message);
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
    console.warn('[NewReleases] Failed to finish run', { runId, status, error: error.message });
  }
}

export async function refreshNewReleasesSnapshot(note?: string): Promise<NewReleasesRefreshResult> {
  const client = requireSupabase();
  await ensureSectionRow(client);

  const runId = await startRun(client, note ?? 'scheduled refresh');
  const generatedAt = DateTime.utc();

  try {
    await refreshCandidates(client);
    const candidates = await fetchCandidates();
    const snapshot = buildSnapshotFromCandidates(candidates, generatedAt);

    await expireOldSnapshots(client, snapshot.generated_at);
    await insertSnapshot(client, snapshot, generatedAt);
    await finishRun(client, runId, 'success', `items=${snapshot.items.length}`);

    return { snapshot, persisted: true, runId };
  } catch (err: any) {
    const errorJson = { message: err?.message || 'unknown_error', detail: err?.stack || null };
    await finishRun(client, runId, 'error', err?.message, errorJson);
    throw err;
  }
}

export async function getNewReleasesSnapshot(): Promise<NewReleasesSnapshot | null> {
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
    console.error('[NewReleases] Failed to read snapshot', error.message);
    return null;
  }

  const payload = (data as any)?.payload as NewReleasesSnapshot | undefined;
  if (!payload) return null;
  return payload;
}

export async function ensureNewReleasesWarmStart(): Promise<void> {
  if (!env.enable_run_jobs) return;
  const existing = await getNewReleasesSnapshot();
  if (existing) return;

  try {
    await refreshNewReleasesSnapshot('bootstrap');
  } catch (err: any) {
    console.warn('[NewReleases] Warm-start refresh failed', err?.message || err);
  }
}

export { SECTION_KEY };
