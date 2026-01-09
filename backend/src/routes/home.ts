import { Router } from 'express';

import { getMostPopularSnapshot } from '../services/mostPopular';
import { getTrendingNowSnapshot } from '../services/trendingNow';

const router = Router();

router.get('/sections/trending-now', async (_req, res) => {
  try {
    const snapshot = await getTrendingNowSnapshot();
    if (!snapshot) {
      return res.status(404).json({ error: 'snapshot_unavailable' });
    }

    res.setHeader('Cache-Control', 'public, max-age=300, stale-while-revalidate=900');
    return res.json(snapshot);
  } catch (err: any) {
    console.error('[home/trending-now] failed', err?.message || err);
    return res.status(500).json({ error: 'snapshot_failed' });
  }
});

router.get('/sections/most-popular', async (_req, res) => {
  try {
    const snapshot = await getMostPopularSnapshot();
    if (!snapshot) {
      return res.status(404).json({ error: 'snapshot_unavailable' });
    }

    res.setHeader('Cache-Control', 'public, max-age=300, stale-while-revalidate=900');
    return res.json(snapshot);
  } catch (err: any) {
    console.error('[home/most-popular] failed', err?.message || err);
    return res.status(500).json({ error: 'snapshot_failed' });
  }
});

export default router;
