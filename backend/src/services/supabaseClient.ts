import { createClient, SupabaseClient } from '@supabase/supabase-js';
import env from '../environments';

let supabase: SupabaseClient;

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
} else {
  // Lazy placeholder to avoid throwing before env is loaded; handlers must guard usage
  console.warn('Supabase credentials missing; set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY');
  // @ts-expect-error intentionally undefined until env provided
  supabase = undefined;
}

export default supabase;
