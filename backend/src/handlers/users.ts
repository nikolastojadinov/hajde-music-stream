import type { Router, Request, Response } from "express";
import supabase from "../services/supabaseClient";

export default function mountUserEndpoints(router: Router) {
  // Sign in: validate Pi auth and create/update user in Supabase
  router.post('/signin', async (req: Request, res: Response) => {
    try {
      console.log('[Backend] /signin called');
      console.log('[Backend] Request body:', JSON.stringify(req.body, null, 2));
      
      const { authResult } = req.body;
      
      if (!authResult) {
        console.log('[Backend] ERROR: Missing authResult');
        return res.status(400).json({ success: false, error: 'Missing authResult' });
      }
      
      const { user, accessToken } = authResult;
      
      if (!user || !user.uid || !user.username) {
        console.log('[Backend] ERROR: Invalid user data in authResult');
        return res.status(400).json({ success: false, error: 'Invalid user data' });
      }

      if (!accessToken) {
        console.log('[Backend] ERROR: Missing accessToken');
        return res.status(400).json({ success: false, error: 'Missing accessToken' });
      }

      console.log('[Backend] Valid authResult received:', {
        uid: user.uid,
        username: user.username,
        hasAccessToken: !!accessToken
      });

      // Check if user exists (using pi_uid from schema)
      const { data: existingUser, error: selectError } = await supabase
        .from('users')
        .select('*')
        .eq('pi_uid', user.uid)
        .single();

      if (selectError && selectError.code !== 'PGRST116') {
        // PGRST116 = not found, which is OK
        console.error('[Backend] Error checking existing user:', selectError);
        return res.status(500).json({ success: false, error: 'Database query failed' });
      }

      let userData;

      if (existingUser) {
        // User exists - update username and timestamp
        console.log('[Backend] User exists, updating...');
        const { data, error: updateError } = await supabase
          .from('users')
          .update({
            username: user.username,
            updated_at: new Date().toISOString()
          })
          .eq('pi_uid', user.uid)
          .select()
          .single();

        if (updateError) {
          console.error('[Backend] Error updating user:', updateError);
          return res.status(500).json({ success: false, error: 'Failed to update user' });
        }

        userData = data;
        console.log('[Backend] User updated successfully');
      } else {
        // User doesn't exist - create new
        console.log('[Backend] Creating new user...');
        const { data, error: insertError } = await supabase
          .from('users')
          .insert({
            pi_uid: user.uid,
            username: user.username,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString()
          })
          .select()
          .single();

        if (insertError) {
          console.error('[Backend] Error creating user:', insertError);
          return res.status(500).json({ success: false, error: 'Failed to create user' });
        }

        userData = data;
        console.log('[Backend] User created successfully');
      }

      // Set session cookie
      res.cookie('pm_session', accessToken, {
        httpOnly: true,
        secure: true,
        sameSite: 'none',
        maxAge: 1000 * 60 * 60 * 24 * 30 // 30 days
      });

      console.log('[Backend] Signin successful, returning user data');

      // Return user data in expected format
      return res.status(200).json({
        user: {
          uid: user.uid,
          username: user.username,
          roles: []
        },
        success: true
      });

    } catch (error: any) {
      console.error('[Backend] Signin unhandled error:', {
        message: error?.message,
        stack: error?.stack,
        error: error
      });
      return res.status(500).json({ success: false, error: 'Internal server error' });
    }
  });

  // Sign out: clear session cookie
  router.get('/signout', async (req: Request, res: Response) => {
    res.clearCookie('pm_session', { sameSite: 'none', secure: true });
    return res.status(200).json({ success: true, message: 'Signed out' });
  });
}
