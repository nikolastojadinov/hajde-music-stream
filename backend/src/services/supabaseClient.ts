import { createClient, type SupabaseClient } from '@supabase/supabase-js';

import env from '../environments';

let supabaseAdmin: SupabaseClient | null = null;

function buildAdminClient(): SupabaseClient {
  const url = (env.supabase_url || '').trim();
  const serviceKey = (env.supabase_service_role_key || '').trim();

  const missing: string[] = [];
  if (!url) missing.push('SUPABASE_URL');
  if (!serviceKey) missing.push('SUPABASE_SERVICE_ROLE_KEY');

  if (missing.length) {
    const reason = missing.join(', ');
    throw new Error(`[Supabase] Admin client not configured: missing ${reason}`);
  }

  try {
    const client = createClient(url, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
      global: {
        headers: {
          apikey: serviceKey,
          Authorization: `Bearer ${serviceKey}`,
        },
      },
    });

    const host = new URL(url).host;
    console.log('[Supabase] Admin client configured', {
      host,
      serviceRoleKeyLength: serviceKey.length,
    });

    return client;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(`[Supabase] Failed to init admin client: ${message}`);
  }
}

export function getSupabaseAdmin(): SupabaseClient {
  if (supabaseAdmin) return supabaseAdmin;
  supabaseAdmin = buildAdminClient();
  return supabaseAdmin;
}

// Default export kept for backward compatibility. Prefer getSupabaseAdmin().
const defaultAdminClient = getSupabaseAdmin();
export default defaultAdminClient;

