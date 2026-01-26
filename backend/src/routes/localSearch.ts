import { Router } from 'express';

import { resolveUserId } from '../lib/resolveUserId';
import {
  fetchActivity,
  fetchLocalSuggest,
  fetchRecentSearches,
  resolveUserIdentity,
  upsertRecentSearch,
  writeActivity,
} from '../services/localSearchService';

const router = Router();

const parseLimit = (raw: unknown, fallback: number) => {
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.min(Math.trunc(n), 50);
};

router.get('/activity', async (req, res) => {
  const userUid = resolveUserId(req);
  if (!userUid) return res.status(401).json({ items: [], status: 'user_missing' });

  const limit = parseLimit(req.query.limit, 15);
  try {
    const items = await fetchActivity(userUid, limit);
    return res.json({ items });
  } catch (err: any) {
    console.error('[local/activity] failed', { message: err?.message || String(err) });
    return res.status(500).json({ items: [] });
  }
});

router.post('/activity', async (req, res) => {
  const userUid = resolveUserId(req);
  const body = req.body || {};
  const entityType = typeof body.entityType === 'string' ? body.entityType.trim() : '';
  const entityId = typeof body.entityId === 'string' ? body.entityId.trim() : '';

  if (!userUid || !entityType || !entityId) {
    console.warn('[local/activity] invalid_payload', { userUid, entityType, entityId });
    return res.status(400).json({ status: 'invalid_payload' });
  }

  try {
    const status = await writeActivity({ userId: userUid, entityType, entityId, context: body.context });
    return res.json({ status });
  } catch (err: any) {
    console.error('[local/activity] insert_failed', { message: err?.message || String(err) });
    return res.status(500).json({ status: 'error' });
  }
});

router.get('/recent-searches', async (req, res) => {
  const userUid = resolveUserId(req);
  if (!userUid) return res.status(401).json({ items: [], status: 'user_missing' });

  const limit = parseLimit(req.query.limit, 15);

  try {
    const identity = await resolveUserIdentity(userUid);
    if (!identity.userUuid) {
      console.warn('[local/recent-searches] user_not_found', { uid: identity.uid });
      return res.status(404).json({ items: [], status: 'user_not_found' });
    }

    const items = await fetchRecentSearches(identity.userUuid, limit);
    return res.json({ items });
  } catch (err: any) {
    console.error('[local/recent-searches] failed', { message: err?.message || String(err) });
    return res.status(500).json({ items: [] });
  }
});

router.post('/recent-searches', async (req, res) => {
  const userUid = resolveUserId(req);
  const query = typeof req.body?.query === 'string' ? req.body.query.trim() : '';
  if (!userUid || !query) {
    console.warn('[local/recent-searches] invalid_payload', { userUid, query });
    return res.status(400).json({ status: 'invalid_payload' });
  }

  try {
    const identity = await resolveUserIdentity(userUid);
    if (!identity.userUuid) {
      console.warn('[local/recent-searches] user_not_found', { uid: identity.uid });
      return res.status(404).json({ status: 'user_not_found' });
    }

    const status = await upsertRecentSearch(identity.userUuid, query);
    if (status !== 'ok') return res.status(500).json({ status: 'error' });
    return res.json({ status });
  } catch (err: any) {
    console.error('[local/recent-searches] upsert_failed', { message: err?.message || String(err) });
    return res.status(500).json({ status: 'error' });
  }
});

router.get('/suggest', async (req, res) => {
  const q = typeof req.query.q === 'string' ? req.query.q : '';
  const limit = parseLimit(req.query.limit, 10);
  if (!q.trim()) return res.json({ q, suggestions: [] });

  try {
    const suggestions = await fetchLocalSuggest(q, limit);
    return res.json({ q, suggestions });
  } catch (err: any) {
    console.error('[local/suggest] failed', { message: err?.message || String(err) });
    return res.status(500).json({ q, suggestions: [] });
  }
});

export default router;
