import { Router } from "express";
import platformAPIClient from "../services/platformAPIClient";
import supabase from "../services/supabaseClient";
import { randomBytes } from "crypto";

export default function mountUserEndpoints(router: Router) {
  // Sign in: verify token, upsert user, create session in Supabase and set cookie
  router.post('/signin', async (req, res) => {
    const auth = req.body?.authResult;
    if (!auth?.accessToken || !auth?.user?.uid) {
      return res.status(400).json({ error: 'invalid_request' });
    }

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
    await supabase.from('users').upsert(userRow, { onConflict: 'uid' });

    // Create session
    const sid = randomBytes(24).toString('hex');
    await supabase.from('sessions').insert({ sid, user_uid: auth.user.uid, created_at: new Date().toISOString() });

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
  router.get('/signout', async (req, res) => {
    const sid = req.cookies?.sid as string | undefined;
    if (sid) {
      await supabase.from('sessions').delete().eq('sid', sid);
    }
    res.clearCookie('sid', { sameSite: 'none', secure: true });
    return res.status(200).json({ message: "User signed out" });
  });
}
