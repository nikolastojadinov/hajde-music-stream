import { createClient, SupabaseClient } from '@supabase/supabase-js';
import env from '../environments';

let externalSupabase: SupabaseClient | null = null;

export function getExternalSupabase(): SupabaseClient {
  if (!externalSupabase) {
    if (!env.external_supabase_url || !env.external_supabase_service_role_key) {
      throw new Error('External Supabase credentials missing. Set EXTERNAL_SUPABASE_URL and EXTERNAL_SUPABASE_SERVICE_ROLE');
    }
    externalSupabase = createClient(env.external_supabase_url, env.external_supabase_service_role_key, {
      auth: { persistSession: false },
    });
  }
  return externalSupabase;
}
