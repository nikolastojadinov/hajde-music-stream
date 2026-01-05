import type { Router, Request, Response } from "express";
import platformAPIClient from "../services/platformAPIClient";
import supabase from "../services/supabaseClient";
import { randomBytes } from "crypto";

export default function mountUserEndpoints(router: Router) {
  // Sign in: verify token, upsert user, create session in Supabase and set cookie
  router.post('/signin', async (req: Request, res: Response) => {
    const auth = req.body?.authResult;
    if (!auth?.accessToken || !auth?.user?.uid) {
      return res.status(400).json({ error: 'invalid_request' });
    }

    if (!supabase) return res.status(500).json({ error: 'supabase_unavailable' });
    const client = supabase;

    try {
      // Verify the user's access token with the /me endpoint:
      await platformAPIClient.get(`/v2/me`, { headers: { 'Authorization': `Bearer ${auth.accessToken}` } });
    } catch (err) {
      console.log(err);
      return res.status(401).json({ error: "Invalid access token" });
    }

    // Upsert user into Supabase
    const userRow = {
      uid: auth.user.uid,
      username: auth.user.username,
      roles: auth.user.roles || [],
      access_token: auth.accessToken,
      updated_at: new Date().toISOString(),
    };
    await client.from('users').upsert(userRow, { onConflict: 'uid' });

    // Create session
    const sid = randomBytes(24).toString('hex');
    await client.from('sessions').insert({ sid, user_uid: auth.user.uid, created_at: new Date().toISOString() });

    // Set cookie for cross-site usage (Netlify -> Render)
    res.cookie('sid', sid, {
      httpOnly: true,
      secure: true,
      sameSite: 'none',
      maxAge: 30 * 24 * 3600 * 1000,
    });

    return res.status(200).json({ message: "User signed in" });
  });

  // Sign out: delete session row and clear cookie
  router.get('/signout', async (req: Request, res: Response) => {
    const sid = req.cookies?.sid as string | undefined;
    if (sid) {
      if (supabase) {
        await supabase.from('sessions').delete().eq('sid', sid);
      }
    }
    res.clearCookie('sid', { sameSite: 'none', secure: true });
    return res.status(200).json({ message: "User signed out" });
  });

  // Get user data by UID (for refreshing user data after payment)
  router.get('/:uid', async (req: Request, res: Response) => {
    const { uid } = req.params;
    
    if (!uid) {
      return res.status(400).json({ error: 'Missing user UID' });
    }

    try {
      // Fetch user from Supabase
      if (!supabase) return res.status(500).json({ error: 'supabase_unavailable' });
      const client = supabase;
      const { data: userRows, error } = await client
        .from('users')
        .select('uid, username, premium, premium_until')
        .eq('uid', uid)
        .limit(1);

      if (error) {
        console.error('[Users] Error fetching user:', error);
        return res.status(500).json({ error: 'Failed to fetch user data' });
      }

      if (!userRows || userRows.length === 0) {
        return res.status(404).json({ error: 'User not found' });
      }

      const user = userRows[0];
      
      return res.status(200).json({ 
        user: {
          uid: user.uid,
          username: user.username,
          premium: user.premium || false,
          premium_until: user.premium_until || null,
        }
      });

    } catch (err) {
      console.error('[Users] Error:', err);
      return res.status(500).json({ error: 'Internal server error' });
    }
  });
}
