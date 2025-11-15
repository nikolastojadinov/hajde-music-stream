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

    try {
      // Verify the user's access token with the /me endpoint:
      const verifyResponse = await platformAPIClient.get(`/v2/me`, { 
        headers: { 'Authorization': `Bearer ${auth.accessToken}` } 
      });
      console.log('[Backend] User verified:', verifyResponse.data);
    } catch (err) {
      console.error('[Backend] Token verification failed:', err);
      return res.status(401).json({ error: "Invalid access token" });
    }

    // Upsert user into Supabase users table
    const { data: existingUser, error: queryError } = await supabase
      .from('users')
      .select('*')
      .eq('pi_uid', auth.user.uid)
      .single();

    let userData;
    if (existingUser) {
      // Update existing user
      const { data, error } = await supabase
        .from('users')
        .update({ 
          username: auth.user.username,
          updated_at: new Date().toISOString()
        })
        .eq('pi_uid', auth.user.uid)
        .select()
        .single();
      
      if (error) {
        console.error('[Backend] Error updating user:', error);
        return res.status(500).json({ error: 'Failed to update user' });
      }
      userData = data;
    } else {
      // Insert new user
      const { data, error } = await supabase
        .from('users')
        .insert({
          pi_uid: auth.user.uid,
          username: auth.user.username,
          wallet_address: null,
        })
        .select()
        .single();
      
      if (error) {
        console.error('[Backend] Error creating user:', error);
        return res.status(500).json({ error: 'Failed to create user' });
      }
      userData = data;
    }

    // Create session
    const sid = randomBytes(24).toString('hex');
    const { error: sessionError } = await supabase
      .from('sessions')
      .insert({ 
        session_id: sid, 
        user_id: userData.id,
        created_at: new Date().toISOString() 
      });

    if (sessionError) {
      console.error('[Backend] Error creating session:', sessionError);
      return res.status(500).json({ error: 'Failed to create session' });
    }

    // Set cookie for cross-site usage (Netlify -> Render)
    res.cookie('sid', sid, {
      httpOnly: true,
      secure: true,
      sameSite: 'none',
      maxAge: 30 * 24 * 3600 * 1000,
    });

    console.log('[Backend] Sign-in successful for user:', auth.user.username);
    return res.status(200).json({ 
      message: "User signed in",
      user: {
        uid: userData.pi_uid,
        username: userData.username,
        roles: []
      }
    });
  });

  // Sign out: delete session row and clear cookie
  router.get('/signout', async (req: Request, res: Response) => {
    const sid = req.cookies?.sid as string | undefined;
    if (sid) {
      await supabase.from('sessions').delete().eq('session_id', sid);
    }
    res.clearCookie('sid', { sameSite: 'none', secure: true });
    return res.status(200).json({ message: "User signed out" });
  });
}
