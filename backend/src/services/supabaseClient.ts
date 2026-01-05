import { createClient, type SupabaseClient } from '@supabase/supabase-js';

import env from '../environments';

// Minimal Supabase client kept ONLY for session/user/Pi flows.
// All music storage, ingestion, and playlist/track persistence have been removed.

let supabase: SupabaseClient | null = null;

if (env.supabase_url && env.supabase_service_role_key) {
  supabase = createClient(env.supabase_url, env.supabase_service_role_key, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: {
      headers: {
        apikey: env.supabase_service_role_key,
        Authorization: `Bearer ${env.supabase_service_role_key}`,
      },
    },
  });

  try {
    const url = new URL(env.supabase_url);
    console.log('[Supabase] configured (session-only)', {
      host: url.host,
      serviceRoleKeyPresent: true,
      serviceRoleKeyLength: env.supabase_service_role_key.length,
    });
  } catch {
    console.log('[Supabase] configured (session-only)', {
      host: 'invalid-url',
      serviceRoleKeyPresent: true,
      serviceRoleKeyLength: env.supabase_service_role_key.length,
    });
  }
} else {
  console.warn('[Supabase] credentials missing; session features will be disabled');
}

export default supabase;

