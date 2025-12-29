type CacheEntry<T> = { data: T; ts: number };

const inFlight = new Map<string, Promise<unknown>>();
const responseCache = new Map<string, CacheEntry<unknown>>();
const eventWindow = new Map<string, number>();

interface RequestOptions {
  ttlMs?: number;
  cache?: boolean;
}

export async function dedupeRequest<T>(key: string, fn: () => Promise<T>, options?: RequestOptions): Promise<T> {
  const now = Date.now();
  const ttl = options?.ttlMs ?? 0;
  const useCache = Boolean(options?.cache && ttl > 0);

  if (useCache) {
    const cached = responseCache.get(key) as CacheEntry<T> | undefined;
    if (cached && now - cached.ts < ttl) {
      return cached.data;
    }
  }

  const existing = inFlight.get(key) as Promise<T> | undefined;
  if (existing) {
    return existing;
  }

  const promise = Promise.resolve(fn())
    .then((result) => {
      if (useCache) {
        responseCache.set(key, { data: result, ts: Date.now() });
      }
      return result;
    })
    .finally(() => {
      inFlight.delete(key);
    });

  inFlight.set(key, promise);
  return promise;
}

export async function dedupeEvent<T>(key: string, windowMs: number, fn: () => Promise<T>): Promise<T | null> {
  const now = Date.now();
  const last = eventWindow.get(key) ?? 0;
  if (now - last < windowMs) {
    const inflight = inFlight.get(key) as Promise<T> | undefined;
    if (inflight) return inflight;
    return null;
  }

  const existing = inFlight.get(key) as Promise<T> | undefined;
  if (existing) {
    return existing;
  }

  eventWindow.set(key, now);
  const promise = Promise.resolve(fn()).finally(() => {
    inFlight.delete(key);
  });

  inFlight.set(key, promise);
  return promise;
}
