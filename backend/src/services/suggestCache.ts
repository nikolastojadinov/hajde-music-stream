// backend/src/services/suggestCache.ts

import fs from "fs/promises";
import path from "path";
import Redis from "ioredis";

import { SUGGESTION_TTL_SECONDS, type SuggestEnvelope } from "../types/suggest";
import supabase from "../services/supabaseClient";

const REDIS_KEY_PREFIX = "suggest:";
const MEMORY_CACHE_MAX = 500;
const FILE_CACHE_PATH = path.join(
  __dirname,
  "..",
  "..",
  "log",
  "suggest-cache.json"
);
const SUPABASE_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

type CacheEntry = {
  value: SuggestEnvelope;
  expiresAtMs: number;
};

type PersistSuggestEntryParams = {
  source: string;
  query: string; // CLEAN, NO PREFIX
  value: SuggestEnvelope;
  ttlSeconds?: number;
  meta?: Record<string, unknown>;
};

let redisClient: Redis | null = null;
let redisReady = false;
let redisAttempted = false;
let redisErrorLogged = false;

const memoryCache = new Map<string, CacheEntry>();
let fileCacheLoaded = false;

/* =========================
   Normalization
========================= */

export function normalizeQuery(q: string): string {
  return (q ?? "")
    .trim()
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ");
}

export function buildSuggestCacheKey(
  userInput: string,
  source: string = "spotify"
): string {
  const normalized = normalizeQuery(userInput);
  if (!normalized) return "";
  return `${source}:${normalized}`;
}

function nowMs(): number {
  return Date.now();
}

/* =========================
   Redis
========================= */

function buildRedisClient(): Redis | null {
  try {
    const commonOptions = {
      lazyConnect: true,
      enableOfflineQueue: false,
      maxRetriesPerRequest: 0,
      retryStrategy: () => null,
    } as const;

    const url = process.env.REDIS_URL;
    if (url) return new Redis(url, commonOptions);

    return new Redis({
      host: process.env.REDIS_HOST || "127.0.0.1",
      port: Number(process.env.REDIS_PORT || 6379),
      password: process.env.REDIS_PASSWORD,
      ...commonOptions,
    });
  } catch {
    return null;
  }
}

function logRedisDisabled(err: unknown): void {
  if (redisErrorLogged) return;
  redisErrorLogged = true;

  const message = err instanceof Error ? err.message : String(err ?? "unknown error");
  console.warn(`[SuggestCache] Redis unavailable, falling back to local cache (${message})`);
}

async function getRedis(): Promise<Redis | null> {
  if (redisReady && redisClient) return redisClient;
  if (redisAttempted) return null;

  redisAttempted = true;
  redisClient = buildRedisClient();
  if (!redisClient) return null;

  redisClient.on("error", (err) => {
    logRedisDisabled(err);
  });

  try {
    if (redisClient.status === "wait") {
      await redisClient.connect();
    }
    redisReady = true;
    return redisClient;
  } catch (err) {
    logRedisDisabled(err);
    redisClient.disconnect();
    redisClient = null;
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
  memoryCache.forEach((entry, key) => {
    if (entry.expiresAtMs <= now) {
      memoryCache.delete(key);
    }
  });

  while (memoryCache.size > MEMORY_CACHE_MAX) {
    const firstKey = memoryCache.keys().next().value;
    if (!firstKey) break;
    memoryCache.delete(firstKey);
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
  } catch {
    // ignore
  }
}

/* =========================
   Supabase persist
========================= */

async function persistSuggestEntry({
  source,
  query,
  value,
  ttlSeconds,
  meta,
}: PersistSuggestEntryParams): Promise<void> {
  if (!supabase) return;

  if (query.includes(":")) {
    console.error("[SuggestCache] BLOCKED prefixed query:", query);
    return;
  }

  try {
    const { error } = await supabase
      .from("suggest_entries")
      .upsert(
        {
          source,
          query,
          normalized_query: query,
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

export async function getCachedSuggest(
  key: string
): Promise<SuggestEnvelope | null> {
  const idx = key.indexOf(":");
  if (idx === -1) return null;

  const source = key.slice(0, idx);
  const query = normalizeQuery(key.slice(idx + 1));
  if (!query) return null;

  const redis = await getRedis();
  if (redis) {
    const raw = await redis.get(redisKey(key));
    if (raw) return JSON.parse(raw);
  }

  await loadFileCache();
  const entry = memoryCache.get(key);
  if (entry && entry.expiresAtMs > nowMs()) return entry.value;

  const { data } = await supabase
    .from("suggest_entries")
    .select("results, ts")
    .eq("source", source)
    .eq("query", query)
    .order("ts", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!data) return null;
  if (Date.now() - new Date(data.ts).getTime() > SUPABASE_MAX_AGE_MS) return null;

  return data.results ?? null;
}

export async function cacheSuggest(
  key: string,
  value: SuggestEnvelope
): Promise<void> {
  const idx = key.indexOf(":");
  if (idx === -1) return;

  const source = key.slice(0, idx);
  const query = normalizeQuery(key.slice(idx + 1));
  if (!query) return;

  const expiresAtMs = nowMs() + SUGGESTION_TTL_SECONDS * 1000;

  const redis = await getRedis();
  if (redis) {
    await redis.setex(
      redisKey(key),
      SUGGESTION_TTL_SECONDS,
      JSON.stringify(value)
    );
  }

  memoryCache.set(key, { value, expiresAtMs });
  pruneMemoryCache(nowMs());

  await persistSuggestEntry({
    source,
    query,
    value,
    ttlSeconds: SUGGESTION_TTL_SECONDS,
  });
}
