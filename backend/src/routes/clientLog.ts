import express, { Request, Response } from 'express';

const router = express.Router();

router.post('/', (req: Request, res: Response) => {
  try {
    const { level = 'info', message, context } = req.body || {};
    const payload = {
      ts: new Date().toISOString(),
      level,
      message,
      context,
    };

    if (level === 'error') {
      console.error('[ClientLog]', payload);
    } else if (level === 'warn') {
      console.warn('[ClientLog]', payload);
    } else {
      console.log('[ClientLog]', payload);
    }

    return res.json({ ok: true });
  } catch (err: any) {
    console.error('[ClientLog] failed', err);
    return res.status(500).json({ ok: false });
  }
});

export default router;
