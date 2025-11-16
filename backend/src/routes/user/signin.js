import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

// Initialize Supabase client
const supabase = supabaseUrl && supabaseKey
  ? createClient(supabaseUrl, supabaseKey, { auth: { persistSession: false } })
  : null;

/**
 * POST /user/signin
 * Accept Pi authentication result and create/update user in Supabase
 * 
 * Request body: { authResult }
 * authResult contains: { user: { uid, username, ... }, accessToken, ... }
 * 
 * Response: { success: true, user: {...} }
 */
export async function handleSignin(req, res) {
  try {
    console.log('[Signin] Request received');
    console.log('[Signin] Body:', JSON.stringify(req.body, null, 2));

    // Validate Supabase client
    if (!supabase) {
      console.error('[Signin] ERROR: Supabase not configured');
      return res.status(500).json({
        success: false,
        error: 'Database not configured',
        details: 'SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY missing'
      });
    }

    // Extract authResult from request body
    const { authResult } = req.body;

    if (!authResult) {
      console.log('[Signin] ERROR: Missing authResult');
      return res.status(400).json({
        success: false,
        error: 'Missing authResult in request body'
      });
    }

    // Extract user data from authResult
    const { user, accessToken } = authResult;

    if (!user || !user.uid) {
      console.log('[Signin] ERROR: Invalid user data');
      return res.status(400).json({
        success: false,
        error: 'Invalid user data - missing uid'
      });
    }

    if (!user.username) {
      console.log('[Signin] ERROR: Missing username');
      return res.status(400).json({
        success: false,
        error: 'Invalid user data - missing username'
      });
    }

    if (!accessToken) {
      console.log('[Signin] ERROR: Missing accessToken');
      return res.status(400).json({
        success: false,
        error: 'Missing accessToken'
      });
    }

    // Extract optional fields
    const pi_uid = user.uid;
    const username = user.username;
    const country = user.country || null;
    const language = user.language || null;
    const wallet = user.wallet || null;

    console.log('[Signin] Processing user:', {
      pi_uid,
      username,
      country,
      language,
      hasAccessToken: !!accessToken
    });

    // Check if user exists
    const { data: existingUser, error: selectError } = await supabase
      .from('users')
      .select('*')
      .eq('pi_uid', pi_uid)
      .maybeSingle();

    if (selectError) {
      console.error('[Signin] Database SELECT error:', {
        message: selectError.message,
        details: selectError.details,
        hint: selectError.hint,
        code: selectError.code
      });
      return res.status(500).json({
        success: false,
        error: 'Database query failed',
        details: selectError.message
      });
    }

    let userData;

    if (existingUser) {
      // User exists - update username and optional fields
      console.log('[Signin] User exists, updating...');

      const updateData = {
        username,
        ...(country && { country }),
        ...(language && { language }),
        ...(wallet && { wallet })
      };

      const { data, error: updateError } = await supabase
        .from('users')
        .update(updateData)
        .eq('pi_uid', pi_uid)
        .select()
        .single();

      if (updateError) {
        console.error('[Signin] Database UPDATE error:', {
          message: updateError.message,
          details: updateError.details,
          hint: updateError.hint,
          code: updateError.code
        });
        return res.status(500).json({
          success: false,
          error: 'Failed to update user',
          details: updateError.message
        });
      }

      userData = data;
      console.log('[Signin] User updated successfully');

    } else {
      // User does not exist - create new
      console.log('[Signin] Creating new user...');

      const newUser = {
        pi_uid,
        username,
        wallet,
        user_consent: true,
        country,
        language,
        created_at: new Date().toISOString()
        // Note: premium_until, spotify_connected, spotify_expires_at are optional (NULL by default)
      };

      console.log('[Signin] Insert data:', JSON.stringify(newUser, null, 2));

      const { data, error: insertError } = await supabase
        .from('users')
        .insert(newUser)
        .select()
        .single();

      if (insertError) {
        console.error('[Signin] Database INSERT error:', {
          message: insertError.message,
          details: insertError.details,
          hint: insertError.hint,
          code: insertError.code,
          fullError: JSON.stringify(insertError)
        });
        return res.status(500).json({
          success: false,
          error: 'Failed to create user',
          details: insertError.message
        });
      }

      userData = data;
      console.log('[Signin] User created successfully');
    }

    // Set session cookie with accessToken
    res.cookie('pm_session', accessToken, {
      httpOnly: true,
      secure: true,
      sameSite: 'none',
      maxAge: 1000 * 60 * 60 * 24 * 30 // 30 days
    });

    console.log('[Signin] Success - returning user data');

    // Return success response
    return res.status(200).json({
      success: true,
      user: userData
    });

  } catch (error) {
    console.error('[Signin] Unhandled exception:', {
      message: error?.message,
      stack: error?.stack,
      error
    });
    return res.status(500).json({
      success: false,
      error: 'Internal server error',
      details: error?.message
    });
  }
}
