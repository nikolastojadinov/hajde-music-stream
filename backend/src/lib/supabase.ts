import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Request } from "express";

import env from "../environments";

type UserSupabaseResult = {
  client: SupabaseClient | null;
  status: number;
  error?: string;
};

function extractBearerToken(raw: string | string[] | undefined): string | null {
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (trimmed.toLowerCase().startsWith("bearer ")) {
    return trimmed.slice(7).trim() || null;
  }
  return trimmed;
}

function readAccessToken(req: Request): string | null {
  const authHeader = extractBearerToken(req.headers.authorization);
  if (authHeader) return authHeader;

  const altHeader = extractBearerToken((req.headers["x-supabase-auth"] as string | undefined) ?? (req.headers["x-supabase-access-token"] as string | undefined));
  if (altHeader) return altHeader;

  const cookieToken = (req as any).cookies?.["sb-access-token"];
  if (typeof cookieToken === "string" && cookieToken.trim()) {
    return cookieToken.trim();
  }

  return null;
}

export function getUserSupabaseClient(req: Request): UserSupabaseResult {
  if (!env.supabase_url || !env.supabase_anon_key) {
    return { client: null, status: 503, error: "supabase_not_configured" };
  }

  const accessToken = readAccessToken(req);
  if (!accessToken) {
    return { client: null, status: 401, error: "supabase_auth_required" };
  }

  const client = createClient(env.supabase_url, env.supabase_anon_key, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: {
      headers: {
        apikey: env.supabase_anon_key,
        Authorization: `Bearer ${accessToken}`,
      },
    },
  });

  return { client, status: 200 };
}
