import { getBackendHeaders } from '@/contexts/PiContext';
import { withBackendOrigin } from '@/lib/backendUrl';

export type LocalActivityItem = {
  entityType: string;
  entityId: string;
  title: string;
  subtitle?: string | null;
  imageUrl?: string | null;
  externalId?: string | null;
  createdAt: string;
};

export type LocalRecentQuery = {
  query: string;
  lastUsedAt: string;
  useCount: number;
};

export type LocalSuggestItem = {
  type: string;
  externalId: string | null;
  title: string;
  subtitle?: string | null;
  imageUrl?: string | null;
};

const toJson = async (response: Response) => {
  const text = await response.text();
  if (!text) return {};
  return JSON.parse(text);
};

export async function fetchLocalActivity(limit = 15): Promise<LocalActivityItem[]> {
  const url = withBackendOrigin(`/api/local/activity?limit=${encodeURIComponent(String(limit))}`);
  const res = await fetch(url, { headers: await getBackendHeaders() });
  const data = await toJson(res);
  const items = Array.isArray(data?.items) ? data.items : [];
  return items.map((row: any) => ({
    entityType: row?.entity_type || row?.entityType || '',
    entityId: row?.entity_id || row?.entityId || '',
    title: row?.title || '',
    subtitle: row?.subtitle ?? null,
    imageUrl: row?.image_url ?? null,
    externalId: row?.external_id ?? null,
    createdAt: row?.created_at || '',
  }));
}

export async function postLocalActivity(payload: { entityType: string; entityId: string; context?: unknown }): Promise<'inserted' | 'skipped_duplicate' | 'skipped_invalid_entity' | 'error'> {
  const url = withBackendOrigin('/api/local/activity');
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(await getBackendHeaders()) },
    body: JSON.stringify(payload),
  });
  const data = await toJson(res);
  return (data?.status as 'inserted' | 'skipped_duplicate' | 'skipped_invalid_entity') || 'error';
}

export async function postLocalRecentSearch(query: string): Promise<'ok' | 'error'> {
  const url = withBackendOrigin('/api/local/recent-searches');
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(await getBackendHeaders()) },
    body: JSON.stringify({ query }),
  });
  const data = await toJson(res);
  return (data?.status as 'ok') || 'error';
}

export async function fetchLocalRecentQueries(limit = 15): Promise<LocalRecentQuery[]> {
  const url = withBackendOrigin(`/api/local/recent-searches?limit=${encodeURIComponent(String(limit))}`);
  const res = await fetch(url, { headers: await getBackendHeaders() });
  const data = await toJson(res);
  const items = Array.isArray(data?.items) ? data.items : [];
  return items.map((row: any) => ({
    query: row?.query || '',
    lastUsedAt: row?.last_used_at || '',
    useCount: Number(row?.use_count) || 0,
  }));
}

export async function fetchLocalSuggest(q: string, limit = 10): Promise<LocalSuggestItem[]> {
  const url = withBackendOrigin(`/api/local/suggest?q=${encodeURIComponent(q)}&limit=${encodeURIComponent(String(limit))}`);
  const res = await fetch(url, { headers: await getBackendHeaders() });
  const data = await toJson(res);
  const items = Array.isArray(data?.suggestions) ? data.suggestions : [];
  return items.map((row: any) => ({
    type: row?.type || 'generic',
    externalId: row?.external_id ?? null,
    title: row?.title || row?.query || q,
    subtitle: row?.subtitle ?? null,
    imageUrl: row?.image_url ?? null,
  }));
}
