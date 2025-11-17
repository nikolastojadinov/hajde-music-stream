/**
 * Pi Network Authentication Route
 * Handles automatic login from Pi Browser
 */

const express = require('express');
const { validatePiAuth } = require('../../lib/piValidator');
const supabase = require('../../services/supabaseClient').default;

const router = express.Router();

/**
 * POST /pi/auth
 * Receives Pi authentication result from frontend
 * Validates and upserts user into Supabase
 */
router.post('/auth', async (req, res) => {
  console.log('[Pi Auth] Received authentication request');
  
  try {
    const authResult = req.body;

    // Validate Pi authentication
    const { valid, payload } = validatePiAuth(authResult);

    if (!valid) {
      console.error('[Pi Auth] Validation failed');
      return res.status(401).json({ error: 'invalid_pi_auth' });
    }

    const { uid, username, accessToken } = payload;

    console.log('[Pi Auth] Upserting user to Supabase:', uid);

    // Upsert user into Supabase users table
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
      console.error('[Pi Auth] Supabase upsert error:', upsertError);
      return res.status(500).json({ 
        error: 'database_error',
        details: upsertError.message 
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

  } catch (error) {
    console.error('[Pi Auth ERROR]', error);
    res.status(500).json({ 
      error: 'authentication_failed',
      message: error.message 
    });
  }
});

module.exports = router;
