import { Router } from 'express';

import { trackActivity } from '../lib/trackActivity';

const router = Router();

router.post('/track', async (req, res) => {
  const userId = typeof req.body?.userId === 'string' ? (req.body.userId as string).trim() : '';
  const entityType = typeof req.body?.entityType === 'string' ? (req.body.entityType as string).trim() : '';
  const entityId = typeof req.body?.entityId === 'string' ? (req.body.entityId as string).trim() : '';
  const context = req.body?.context;

  if (!userId || !entityType || !entityId) {
    return res.status(400).json({ error: 'invalid_payload' });
  }

  try {
    await trackActivity({ userId, entityType, entityId, context });
    return res.status(204).send();
  } catch (err: any) {
    console.error('[activity/track] failed', { message: err?.message || String(err) });
    return res.status(500).json({ error: 'activity_track_failed' });
  }
});

export default router;
