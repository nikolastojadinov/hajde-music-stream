// CLEANUP DIRECTIVE: Serve playlist category metadata through the backend.
import { Router, Request, Response } from 'express';
import supabase from '../services/supabaseClient';

const router = Router();

const GROUP_KEYS = [
  'region',
  'era',
  'genre',
  'theme',
  'popularity',
  'special',
] as const;

export type CategoryGroup = (typeof GROUP_KEYS)[number];

const isGroupKey = (value: unknown): value is CategoryGroup =>
  typeof value === 'string' && (GROUP_KEYS as readonly string[]).includes(value);

export type CategoryRow = {
  id: number;
  name: string;
  label: string | null;
  group_type: string | null;
  key: string | null;
  group_key: string | null;
};

export type CategoryResponseItem = {
  id: number;
  name: string;
  label: string;
  group_type: CategoryGroup;
  key: string | null;
  group_key: string | null;
};

export type CategoryResponsePayload = Record<CategoryGroup, CategoryResponseItem[]>;

const buildEmptyPayload = (): CategoryResponsePayload =>
  GROUP_KEYS.reduce((acc, key) => {
    acc[key] = [];
    return acc;
  }, {} as CategoryResponsePayload);

// Simple in-memory cache to avoid duplicate hits from rapid double-mounts
const categoriesCache: { payload: CategoryResponsePayload | null; ts: number } = {
  payload: null,
  ts: 0,
};
const CATEGORIES_TTL_MS = 2000;

const normalizeCategory = (row: CategoryRow): CategoryResponseItem => {
  const fallbackGroup = 'genre' as CategoryGroup;
  const rawGroup = row.group_type ?? fallbackGroup;
  const normalizedGroup = isGroupKey(rawGroup) ? rawGroup : 'special';

  return {
    id: row.id,
    name: row.name,
    label: row.label?.trim() || row.name,
    group_type: normalizedGroup,
    key: row.key,
    group_key: row.group_key,
  };
};

router.get('/', async (req: Request, res: Response) => {
  const requester = (req as Request & { currentUser?: { uid?: string } | null }).currentUser?.uid ?? null;
  console.log('[categories] Incoming request', { requester });
  if (!supabase) {
    return res.status(500).json({ error: 'Supabase client is not configured.' });
  }

  const now = Date.now();
  if (categoriesCache.payload && now - categoriesCache.ts < CATEGORIES_TTL_MS) {
    return res.status(200).json(categoriesCache.payload);
  }

  try {
    const { data, error } = await supabase
      .from('categories')
      .select('id,name,label,group_type,key,group_key')
      .order('label', { ascending: true });

    if (error) {
      console.error('[categories] Failed to load categories', error);
      return res.status(500).json({ error: 'Failed to load categories.' });
    }

    const payload = buildEmptyPayload();
    (data ?? []).forEach((row) => {
      const normalized = normalizeCategory(row as CategoryRow);
      payload[normalized.group_type].push(normalized);
    });

    categoriesCache.payload = payload;
    categoriesCache.ts = now;

    return res.status(200).json(payload);
  } catch (err) {
    console.error('[categories] Unexpected error', err);
    return res.status(500).json({ error: 'Unexpected error occurred while loading categories.' });
  }
});

export default router;
