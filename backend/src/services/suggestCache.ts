import fs from "fs/promises";
import path from "path";
import Redis from "ioredis";

import { SUGGESTION_TTL_SECONDS, type SuggestEnvelope } from "../types/suggest";
import supabase from "../services/supabaseClient";

const REDIS_KEY_PREFIX = "suggest:";
const MEMORY_CACHE_MAX = 500;
const FILE_CACHE_PATH = path.join(__dirname, "..", "..", "log", "suggest-cache.json");
const SUPABASE_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

type CacheEntry = { value: SuggestEnvelope; expiresAtMs: number };

type PersistSuggestEntryParams = {
  key: string;
  value: SuggestEnvelope;
  ttlSeconds?: number;
  meta?: Record<string, unknown>;
};

let redisClient: Redis | null = null;
let redisReady = false;
let redisAttempted = false;

const memoryCache = new Map<string, CacheEntry>();
let fileCacheLoaded = false;

/* =========================
   Normalization helpers
========================= */

export function normalizeQuery(q: string): string {
  return (q ?? "")
    .trim()
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ");
}

export function buildSuggestCacheKey(userInput: string, source: string = "spotify"): string {
  const normalized = normalizeQuery(userInput);
  if (!normalized) return "";
  return `${source}:${normalized}`;
}

function extractSourceAndQuery(key: string): { source: string; query: string } {
  const idx = key.indexOf(":");
  if (idx === -1) return { source: "unknown", query: key };
  return {
    source: key.slice(0, idx),
    query: key.slice(idx + 1),
  };
}

function normalizeKey(key: string): string {
  const { source, query } = extractSourceAndQuery(key);
  const normalizedQuery = normalizeQuery(query);
  if (!normalizedQuery) return "";
  return `${source}:${normalizedQuery}`;
}

function nowMs(): number {
  return Date.now();
}

/* =========================
   Redis
========================= */

function buildRedisClient(): Redis | null {
  try {
    const url = process.env.REDIS_URL;
    if (url) return new Redis(url, { lazyConnect: true });

    return new Redis({
      host: process.env.REDIS_HOST || "127.0.0.1",
      port: Number(process.env.REDIS_PORT || 6379),
      password: process.env.REDIS_PASSWORD,
      lazyConnect: true,
    });
  } catch {
    return null;
  }
}

async function getRedis(): Promise<Redis | null> {
  if (redisReady && redisClient) return redisClient;
  if (redisAttempted) return null;

  redisAttempted = true;
  redisClient = buildRedisClient();
  if (!redisClient) return null;

  try {
    if (redisClient.status === "wait") await redisClient.connect();
    redisReady = true;
    return redisClient;
  } catch {
    redisReady = false;
    return null;
  }
}

function redisKey(key: string): string {
  return `${REDIS_KEY_PREFIX}${key}`;
}

/* =========================
   Local cache
========================= */

function pruneMemoryCache(now: number): void {
  for (const [k, v] of memoryCache.entries()) {
    if (v.expiresAtMs <= now) memoryCache.delete(k);
  }

  while (memoryCache.size > MEMORY_CACHE_MAX) {
    const oldest = memoryCache.keys().next().value;
    if (!oldest) break;
    memoryCache.delete(oldest);
  }
}

async function loadFileCache(): Promise<void> {
  if (fileCacheLoaded) return;
  fileCacheLoaded = true;

  try {
    const raw = await fs.readFile(FILE_CACHE_PATH, "utf8");
    const parsed = JSON.parse(raw)?.entries ?? [];
    const now = nowMs();

    for (const e of parsed) {
      if (e.expiresAtMs > now) {
        memoryCache.set(e.key, {
          value: e.value,
          expiresAtMs: e.expiresAtMs,
        });
      }
    }
  } catch {}
}

/* =========================
   Supabase persist (FIXED)
========================= */

async function persistSuggestEntry({
  key,
  value,
  ttlSeconds,
  meta,
}: PersistSuggestEntryParams): Promise<void> {
  if (!supabase) return;

  const { source, query } = extractSourceAndQuery(key);
  const normalizedQuery = normalizeQuery(query);

  try {
    const { error } = await supabase
      .from("suggest_entries")
      .upsert(
        {
          source,                 // spotify
          query,                  // ✅ "paulo londra" (NO PREFIX)
          normalized_query: normalizedQuery,
          results: value,
          ttl_seconds: ttlSeconds ?? null,
          meta: meta ?? {},
          ts: new Date().toISOString(),
        },
        { onConflict: "query" }
      );

    if (error) throw error;
  } catch (err) {
    console.warn("[SuggestCache] persist failed", err);
  }
}

/* =========================
   Public API
========================= */

export async function getCachedSuggest(key: string): Promise<SuggestEnvelope | null> {
  const normalizedKey = normalizeKey(key);
  if (!normalizedKey) return null;

  const redis = await getRedis();
  if (redis) {
    const raw = await redis.get(redisKey(normalizedKey));
    if (raw) return JSON.parse(raw);
  }

  await loadFileCache();
  const entry = memoryCache.get(normalizedKey);
  if (entry && entry.expiresAtMs > nowMs()) return entry.value;

  const { source, query } = extractSourceAndQuery(normalizedKey);
  const normalizedQuery = normalizeQuery(query);

  const { data } = await supabase
    .from("suggest_entries")
    .select("results, ts")
    .eq("normalized_query", normalizedQuery)
    .eq("source", source)
    .order("ts", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!data) return null;

  if (Date.now() - new Date(data.ts).getTime() > SUPABASE_MAX_AGE_MS) return null;

  return data.results ?? null;
}

export async function cacheSuggest(key: string, value: SuggestEnvelope): Promise<void> {
  const normalizedKey = normalizeKey(key);
  if (!normalizedKey) return;

  const expiresAtMs = nowMs() + SUGGESTION_TTL_SECONDS * 1000;

  const redis = await getRedis();
  if (redis) {
    await redis.setex(
      redisKey(normalizedKey),
      SUGGESTION_TTL_SECONDS,
      JSON.stringify(value)
    );
  }

  memoryCache.set(normalizedKey, { value, expiresAtMs });
  pruneMemoryCache(nowMs());

  await persistSuggestEntry({
    key: normalizedKey,
    value,
    ttlSeconds: SUGGESTION_TTL_SECONDS,
  });
}
