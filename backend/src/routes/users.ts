import { Router, Request, Response } from 'express';
import { piAuth } from '../middleware/piAuth';
import supabase from '../services/supabaseClient';

const router = Router();
router.use(piAuth);

type AuthedRequest = Request & {
  user?: {
    id?: string;
  };
};

router.get('/me', async (req: AuthedRequest, res: Response) => {
  try {
    if (!supabase) {
      console.error('[users] Supabase client not configured');
      return res.status(500).json({ error: 'supabase_not_initialized' });
    }

    const wallet = req.user?.id;
    if (!wallet) {
      return res.status(401).json({ error: 'not_authenticated' });
    }

    const { data, error } = await supabase
      .from('users')
      .select('id, wallet, username, premium_until')
      .eq('wallet', wallet)
      .limit(1)
      .maybeSingle();

    if (error) {
      console.error('[users] Failed to fetch current user', error);
      return res.status(500).json({ error: 'user_lookup_failed' });
    }

    if (!data) {
      return res.status(404).json({ error: 'user_not_found' });
    }

    const premium = Boolean(data.premium_until && new Date(data.premium_until) > new Date());

    return res.json({
      owner_id: data.id,
      wallet: data.wallet,
      username: data.username,
      premium,
      premium_until: data.premium_until,
    });
  } catch (err) {
    console.error('[users] Unexpected error while resolving profile', err);
    return res.status(500).json({ error: 'internal_error' });
  }
});

export default router;
