import { createHash } from 'crypto';
import { createClient, SupabaseClient } from '@supabase/supabase-js';

import env from '../environments';

export type ApiUsageStatus = 'ok' | 'error';

export type ApiUsageRow = {
  ts: string;
  api_key_hash: string;
  endpoint: string;
  quota_cost: number;
  status: ApiUsageStatus;
  error_code: string | null;
  error_message: string | null;
};

function sha256Hex(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function safeString(input: unknown, maxLen: number): string | null {
  if (typeof input !== 'string') return null;
  const trimmed = input.trim();
  if (!trimmed) return null;
  if (trimmed.length <= maxLen) return trimmed;
  return trimmed.slice(0, maxLen);
}

function sanitizeErrorMessage(message: unknown): string | null {
  const str = safeString(message, 180);
  if (!str) return null;

  // Best-effort redaction: avoid leaking obvious secrets in error strings.
  // We never log headers/tokens directly; this protects against accidental inclusion.
  return str
    .replace(/Bearer\s+[A-Za-z0-9._-]+/gi, 'Bearer [redacted]')
    .replace(/key=([A-Za-z0-9_-]+)/gi, 'key=[redacted]')
    .replace(/client_secret=([A-Za-z0-9_-]+)/gi, 'client_secret=[redacted]');
}

export function hashApiKeyOrIdentifier(value: string | null | undefined): string {
  const stable = value && value.trim().length > 0 ? value.trim() : 'unknown';
  return sha256Hex(stable);
}

let loggingClient: SupabaseClient | null = null;
let loggingClientInitAttempted = false;

function getLoggingClient(): SupabaseClient | null {
  if (loggingClient) return loggingClient;
  if (loggingClientInitAttempted) return null;
  loggingClientInitAttempted = true;

  if (!env.supabase_url || !env.supabase_service_role_key) {
    return null;
  }

  loggingClient = createClient(env.supabase_url, env.supabase_service_role_key, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: {
      headers: {
        apikey: env.supabase_service_role_key,
        Authorization: `Bearer ${env.supabase_service_role_key}`,
      },
    },
  });

  return loggingClient;
}

export type LogApiUsageParams = {
  apiKeyOrIdentifier?: string | null;
  endpoint: string;
  quotaCost: number;
  status: ApiUsageStatus;
  errorCode?: string | number | null;
  errorMessage?: string | null;
  ts?: string;
};

export async function logApiUsage(params: LogApiUsageParams): Promise<void> {
  try {
    const client = getLoggingClient();
    if (!client) return;

    const ts = params.ts ?? new Date().toISOString();
    const apiKeyHash = hashApiKeyOrIdentifier(params.apiKeyOrIdentifier ?? null);

    const row: ApiUsageRow = {
      ts,
      api_key_hash: apiKeyHash,
      endpoint: params.endpoint,
      quota_cost: params.quotaCost,
      status: params.status,
      error_code: params.errorCode == null ? null : String(params.errorCode).slice(0, 24),
      error_message: sanitizeErrorMessage(params.errorMessage),
    };

    // Non-blocking insert; the caller should not await this.
    await client.from('api_usage').insert(row);
  } catch {
    // Never throw (fail silently).
  }
}
