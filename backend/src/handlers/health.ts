import type { Router, Request, Response } from 'express';
import env from '../environments';
import supabase from '../services/supabaseClient';

export default function mountHealthEndpoints(router: Router) {
  router.get('/health', async (_req: Request, res: Response) => {
    const configured = Boolean(env.supabase_url && env.supabase_service_role_key);
    let dbOk: boolean | null = null;
    try {
      if (configured && supabase) {
        const { error } = await supabase.from('users').select('uid', { head: true, count: 'exact' });
        dbOk = !error;
      }
    } catch (_e) {
      dbOk = false;
    }

    res.status(200).json({
      status: 'ok',
      ok: true,
      service: 'backend',
      version: '2025-11-16-payment-fix-v2',
      git_commit: '3dc830f',
      time: new Date().toISOString(),
      supabase: { configured, dbOk, url: env.supabase_url || null },
    });
  });
}
