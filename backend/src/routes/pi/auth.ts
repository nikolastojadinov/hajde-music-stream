/**
 * Pi Network Authentication Route
 * Handles automatic login from Pi Browser
 */

import express, { Request, Response } from 'express';
import { validatePiAuth } from '../../lib/piValidator';
import supabase from '../../services/supabaseClient';

const router = express.Router();

/**
 * POST /pi/auth
 * Receives Pi authentication result from frontend
 * Validates and upserts user into Supabase
 */
router.post('/auth', async (req: Request, res: Response) => {
  console.log('[Pi Auth] Received authentication request');
  
  try {
    const authResult = req.body;

    // Validate Pi authentication
    const { valid, payload } = validatePiAuth(authResult);

    if (!valid) {
      console.error('[Pi Auth] Validation failed');
      return res.status(401).json({ error: 'invalid_pi_auth' });
    }

    const { uid, username } = payload;

    console.log('[Pi Auth] Upserting user to Supabase:', uid, 'username:', username);
    console.log('[Pi Auth] Supabase URL:', process.env.SUPABASE_URL);
    console.log('[Pi Auth] Service role key exists:', !!process.env.SUPABASE_SERVICE_ROLE_KEY);

    // Check if Supabase client is configured
    if (!supabase) {
      console.error('[Pi Auth] Supabase client not initialized!');
      return res.status(500).json({ 
        error: 'database_error',
        details: 'Supabase client not configured'
      });
    }

    // Upsert user into Supabase users table
    console.log('[Pi Auth] Executing upsert...');
    const { data: userData, error: upsertError } = await supabase
      .from('users')
      .upsert(
        {
          wallet: uid,
          user_consent: true,
          username: username || uid,
          // premium_until remains unchanged (existing value preserved)
        },
        {
          onConflict: 'wallet',
          ignoreDuplicates: false,
        }
      )
      .select()
      .single();

    if (upsertError) {
      console.error('[Pi Auth] Supabase upsert error FULL:', JSON.stringify(upsertError, null, 2));
      console.error('[Pi Auth] Error code:', upsertError.code);
      console.error('[Pi Auth] Error message:', upsertError.message);
      console.error('[Pi Auth] Error details:', upsertError.details);
      console.error('[Pi Auth] Error hint:', upsertError.hint);
      return res.status(500).json({ 
        error: 'database_error',
        details: upsertError.message,
        code: upsertError.code,
        hint: upsertError.hint
      });
    }

    console.log('[Pi Auth] User upserted successfully:', userData);

    // Return sanitized user profile
    res.json({
      success: true,
      user: {
        uid: userData.wallet,
        username: userData.username,
        premium: userData.premium_until ? new Date(userData.premium_until) > new Date() : false,
        premium_until: userData.premium_until,
      }
    });

  } catch (error: any) {
    console.error('[Pi Auth ERROR]', error);
    res.status(500).json({ 
      error: 'authentication_failed',
      message: error.message 
    });
  }
});

export default router;
