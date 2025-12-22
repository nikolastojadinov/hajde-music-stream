import fs from "fs/promises";
import path from "path";
import Redis from "ioredis";

import { SUGGESTION_TTL_SECONDS, type SuggestEnvelope } from "../types/suggest";
import supabase from "../services/supabaseClient";

const REDIS_KEY_PREFIX = "suggest:";
const MEMORY_CACHE_MAX = 500;
const FILE_CACHE_PATH = path.join(__dirname, "..", "..", "log", "suggest-cache.json");

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

function nowMs(): number {
  return Date.now();
}

function buildRedisClient(): Redis | null {
  try {
    const url = process.env.REDIS_URL;
    if (url) {
      return new Redis(url, { lazyConnect: true });
    }

    const host = process.env.REDIS_HOST || "127.0.0.1";
    const port = Number(process.env.REDIS_PORT || 6379);
    const password = process.env.REDIS_PASSWORD;

    return new Redis({ host, port, password, lazyConnect: true });
  } catch (err) {
    console.warn("[SuggestCache] Failed to create Redis client", { message: err instanceof Error ? err.message : err });
    return null;
  }
}

async function getRedis(): Promise<Redis | null> {
  if (redisReady && redisClient) return redisClient;
  if (redisAttempted && !redisReady) return null;

  redisAttempted = true;
  redisClient = buildRedisClient();
  if (!redisClient) return null;

  redisClient.on("error", () => {
    redisReady = false;
  });

  redisClient.on("end", () => {
    redisReady = false;
  });

  try {
    if (redisClient.status === "wait") {
      await redisClient.connect();
    }
    redisReady = true;
    return redisClient;
  } catch (err) {
    redisReady = false;
    console.warn("[SuggestCache] Redis unavailable, falling back to local cache", {
      message: err instanceof Error ? err.message : err,
    });
    return null;
  }
}

function redisKey(key: string): string {
  return `${REDIS_KEY_PREFIX}${key}`;
}

function pruneMemoryCache(now: number): void {
  const expired: string[] = [];
  memoryCache.forEach((entry, key) => {
    if (entry.expiresAtMs <= now) expired.push(key);
  });
  for (const key of expired) memoryCache.delete(key);

  while (memoryCache.size > MEMORY_CACHE_MAX) {
    const oldest = memoryCache.keys().next().value as string | undefined;
    if (!oldest) break;
    memoryCache.delete(oldest);
  }
}

async function loadFileCache(): Promise<void> {
  if (fileCacheLoaded) return;
  fileCacheLoaded = true;

  try {
    const raw = await fs.readFile(FILE_CACHE_PATH, "utf8");
    const parsed = JSON.parse(raw) as { entries?: CacheEntry[] | Array<{ key: string; value: SuggestEnvelope; expiresAtMs: number }> };
    const entries = Array.isArray((parsed as any)?.entries) ? (parsed as any).entries : [];
    const now = nowMs();
    for (const entry of entries) {
      const key = (entry as any).key ?? null;
      const expiresAtMs = Number((entry as any).expiresAtMs);
      const value = (entry as any).value as SuggestEnvelope | undefined;
      if (typeof key !== "string" || !value || Number.isNaN(expiresAtMs)) continue;
      if (expiresAtMs <= now) continue;
      memoryCache.set(key, { value, expiresAtMs });
    }
    pruneMemoryCache(now);
  } catch (err) {
    // If file missing or unreadable, ignore; fallback to memory only.
    if (err && (err as any).code !== "ENOENT") {
      console.warn("[SuggestCache] Failed to load file cache", { message: err instanceof Error ? err.message : err });
    }
  }
}

function extractSourceAndQuery(key: string): { source: string; query: string } {
  const separatorIndex = key.indexOf(":");
  if (separatorIndex === -1) {
    return { source: "unknown", query: key };
  }

  const source = key.slice(0, separatorIndex) || "unknown";
  const query = key.slice(separatorIndex + 1) || key;
  return { source, query };
}

async function persistSuggestEntry({ key, value, ttlSeconds, meta }: PersistSuggestEntryParams): Promise<void> {
  if (!supabase) return;

  const { source, query } = extractSourceAndQuery(key);

  try {
    const { error } = await supabase.from("suggest_entries").insert({
      source,
      query,
      results: value,
      ttl_seconds: ttlSeconds ?? null,
      meta: meta ?? {},
    });

    if (error) throw error;
  } catch (err) {
    console.warn("[SuggestCache] Failed to persist suggest entry", {
      key,
      message: err instanceof Error ? err.message : err,
    });
  }
}

async function persistFileCache(): Promise<void> {
  try {
    await fs.mkdir(path.dirname(FILE_CACHE_PATH), { recursive: true });
    const entries = Array.from(memoryCache.entries()).map(([key, entry]) => ({ key, value: entry.value, expiresAtMs: entry.expiresAtMs }));
    await fs.writeFile(FILE_CACHE_PATH, JSON.stringify({ entries }, null, 2), "utf8");
  } catch (err) {
    console.warn("[SuggestCache] Failed to persist file cache", { message: err instanceof Error ? err.message : err });
  }
}

export async function getCachedSuggest(key: string): Promise<SuggestEnvelope | null> {
  const redis = await getRedis();
  if (redis) {
    try {
      const raw = await redis.get(redisKey(key));
      if (typeof raw === "string" && raw.length > 0) {
        const value = JSON.parse(raw) as SuggestEnvelope;
        return value;
      }
    } catch (err) {
      console.warn("[SuggestCache] Redis get failed, using fallback", { message: err instanceof Error ? err.message : err });
    }
  }

  await loadFileCache();
  const now = nowMs();
  pruneMemoryCache(now);
  const entry = memoryCache.get(key);
  if (!entry) return null;
  if (entry.expiresAtMs <= now) {
    memoryCache.delete(key);
    return null;
  }
  return entry.value;
}

export async function cacheSuggest(key: string, value: SuggestEnvelope): Promise<void> {
  const redis = await getRedis();
  const expiresAtMs = nowMs() + SUGGESTION_TTL_SECONDS * 1000;

  if (redis) {
    try {
      await redis.setex(redisKey(key), SUGGESTION_TTL_SECONDS, JSON.stringify(value));
      void persistSuggestEntry({ key, value, ttlSeconds: SUGGESTION_TTL_SECONDS });
      return;
    } catch (err) {
      console.warn("[SuggestCache] Redis set failed, using fallback", { message: err instanceof Error ? err.message : err });
    }
  }

  await loadFileCache();
  memoryCache.set(key, { value, expiresAtMs });
  pruneMemoryCache(nowMs());
  await persistFileCache();
  void persistSuggestEntry({ key, value, ttlSeconds: SUGGESTION_TTL_SECONDS });
}
