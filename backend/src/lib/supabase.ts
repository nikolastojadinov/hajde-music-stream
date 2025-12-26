import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Request } from "express";
import jwt from "jsonwebtoken";

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

function readPiUserId(req: Request): string | null {
  const piUser = (req as any).user as { id?: string } | undefined;
  const sessionUser = req.currentUser?.uid ?? null;
  const headerUser = typeof req.headers["x-pi-user-id"] === "string" ? (req.headers["x-pi-user-id"] as string) : null;

  const raw = (piUser?.id as string | undefined) || sessionUser || headerUser || "";
  const trimmed = typeof raw === "string" ? raw.trim() : "";
  return trimmed || null;
}

export function getUserSupabaseClient(req: Request): UserSupabaseResult {
  if (!env.supabase_url || !env.supabase_anon_key) {
    return { client: null, status: 503, error: "supabase_not_configured" };
  }

  const accessToken = readAccessToken(req);
  const piUserId = readPiUserId(req);
  let mintedToken: string | null = null;

  if (!accessToken && !piUserId) {
    return { client: null, status: 401, error: "supabase_auth_required" };
  }

  if (!accessToken && piUserId && env.supabase_jwt_secret) {
    try {
      mintedToken = jwt.sign(
        { sub: piUserId, role: "authenticated", aud: "authenticated" },
        env.supabase_jwt_secret,
        { expiresIn: "15m" }
      );
    } catch {
      // fall through; will still require a token
    }
  }

  const bearer = accessToken || mintedToken;
  if (!bearer) {
    return { client: null, status: 401, error: "supabase_auth_required" };
  }

  const headers: Record<string, string> = {
    apikey: env.supabase_anon_key,
  };

  headers.Authorization = `Bearer ${bearer}`;

  if (piUserId) {
    headers["x-pi-user-id"] = piUserId;
  }

  const client = createClient(env.supabase_url, env.supabase_anon_key, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers },
  });

  return { client, status: 200 };
}
