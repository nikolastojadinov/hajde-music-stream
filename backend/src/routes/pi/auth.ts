/**
 * Pi Network Authentication Route
 * Handles automatic login from Pi Browser
 */

import express, { Request, Response } from 'express';
import { randomBytes } from 'crypto';
import { validatePiAuth } from '../../lib/piValidator';
import supabase from '../../services/supabaseClient';

const router = express.Router();

/**
 * POST /pi/auth
 * Receives Pi authentication result from frontend
 * Validates and upserts user into Supabase
 */
router.post('/auth', async (req: Request, res: Response) => {
  const startedAt = new Date().toISOString();
  console.log('[Pi Auth] Received authentication request', { startedAt });
  
  try {
    const authResult = req.body;

    console.log('[Pi Auth] Incoming payload keys', authResult ? Object.keys(authResult) : null);
    if (authResult?.user?.uid) {
      console.log('[Pi Auth] Incoming user', { uid: authResult.user.uid, username: authResult.user.username });
    }

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

    // Create or refresh session so backend endpoints can identify the user via cookies
    const sessionId = randomBytes(24).toString('hex');
    const { error: deleteSessionError } = await supabase
      .from('sessions')
      .delete()
      .eq('user_uid', uid);

    if (deleteSessionError) {
      console.warn('[Pi Auth] Failed to prune old sessions', { deleteSessionError, uid });
    }

    const { error: sessionError } = await supabase
      .from('sessions')
      .insert({ sid: sessionId, user_uid: uid, created_at: new Date().toISOString() });

    if (sessionError) {
      console.error('[Pi Auth] Failed to create session', sessionError);
      return res.status(500).json({ error: 'session_creation_failed' });
    }

    res.cookie('sid', sessionId, {
      httpOnly: true,
      secure: true,
      sameSite: 'none',
      maxAge: 30 * 24 * 3600 * 1000,
    });

    // Return sanitized user profile
    const responsePayload = {
      success: true,
      user: {
        uid: userData.wallet,
        username: userData.username,
        premium: userData.premium_until ? new Date(userData.premium_until) > new Date() : false,
        premium_until: userData.premium_until,
      }
    };

    console.log('[Pi Auth] Responding success', { uid: responsePayload.user.uid, premium: responsePayload.user.premium, startedAt, finishedAt: new Date().toISOString() });
    res.json(responsePayload);

  } catch (error: any) {
    console.error('[Pi Auth ERROR]', error);
    res.status(500).json({ 
      error: 'authentication_failed',
      message: error.message 
    });
  }
});

export default router;
