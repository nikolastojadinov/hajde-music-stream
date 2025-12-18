import { withBackendOrigin } from "@/lib/backendUrl";

type CacheEntry = { at: number; value: any };

const INFLIGHT = new Map<string, Promise<any>>();
const COMPLETED = new Map<string, CacheEntry>();

// Short TTL: meant only to dedupe rapid repeats (hover prefetch + navigation + StrictMode double effects).
const COMPLETED_TTL_MS = 5_000;

function now() {
  return Date.now();
}

function getFreshCompleted(key: string): any | null {
  const entry = COMPLETED.get(key);
  if (!entry) return null;
  if (now() - entry.at > COMPLETED_TTL_MS) {
    COMPLETED.delete(key);
    return null;
  }
  return entry.value;
}

async function fetchJson(url: string): Promise<any> {
  const res = await fetch(url, {
    method: "GET",
    headers: { Accept: "application/json" },
    credentials: "include",
  });

  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = typeof json?.error === "string" ? json.error : "Artist request failed";
    throw new Error(msg);
  }

  return json;
}

export async function fetchArtistByKey(
  artistKey: string,
  opts?: {
    /** Bypass in-memory dedupe/cache. */
    force?: boolean;
  }
): Promise<any> {
  const key = (artistKey || "").trim();
  if (!key) throw new Error("Missing artist");

  const url = withBackendOrigin(`/api/artist?artist_key=${encodeURIComponent(key)}`);

  if (!opts?.force) {
    const cached = getFreshCompleted(url);
    if (cached != null) return cached;

    const inflight = INFLIGHT.get(url);
    if (inflight) return inflight;
  }

  const p = fetchJson(url)
    .then((value) => {
      COMPLETED.set(url, { at: now(), value });
      return value;
    })
    .finally(() => {
      INFLIGHT.delete(url);
    });

  if (!opts?.force) INFLIGHT.set(url, p);
  return p;
}

export function prefetchArtistByKey(artistKey: string): void {
  const key = (artistKey || "").trim();
  if (!key) return;
  void fetchArtistByKey(key).catch(() => {
    // best-effort prefetch; ignore errors
  });
}
