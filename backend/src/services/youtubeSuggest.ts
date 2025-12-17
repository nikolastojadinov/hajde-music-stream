import { logApiUsage } from "./apiUsageLogger";

const YOUTUBE_SUGGEST_ENDPOINT = "https://suggestqueries.google.com/complete/search";
const MIN_QUERY_CHARS = 2;

function normalizeQuery(q: unknown): string {
  return typeof q === "string" ? q.trim() : "";
}

/**
 * YouTube autocomplete endpoint (used by youtube.com).
 * - Not YouTube Data API
 * - No API key
 * - No quota cost
 */
export async function youtubeSuggest(q: string): Promise<string[]> {
  const query = normalizeQuery(q);
  if (query.length < MIN_QUERY_CHARS) return [];

  const url = new URL(YOUTUBE_SUGGEST_ENDPOINT);
  // IMPORTANT:
  // - client=youtube returns a JavaScript callback wrapper (text/javascript)
  // - client=firefox returns a plain JSON array, safe to parse server-side
  url.searchParams.set("client", "firefox");
  url.searchParams.set("ds", "yt");
  url.searchParams.set("q", query);

  let status: "ok" | "error" = "ok";
  let errorCode: string | null = null;
  let errorMessage: string | null = null;

  try {
    const response = await fetch(url.toString(), {
      method: "GET",
      headers: {
        Accept: "application/json",
        // Some environments (proxies/CDNs) are picky; a UA helps reduce odd responses.
        "User-Agent": "hajde-music-stream/1.0",
      },
    });

    if (!response.ok) {
      status = "error";
      errorCode = String(response.status);
      errorMessage = "YouTube suggest failed";
      return [];
    }

    const json = await response.json().catch(() => null);
    // Format: [query, [suggestions...], ...]
    const suggestionsRaw = Array.isArray(json) ? (json as any[])[1] : null;
    const suggestions = Array.isArray(suggestionsRaw) ? suggestionsRaw : [];

    return suggestions
      .map((s) => (typeof s === "string" ? s.trim() : ""))
      .filter(Boolean)
      .slice(0, 10);
  } catch (err: any) {
    status = "error";
    errorMessage = err?.message ? String(err.message) : "YouTube suggest failed";
    return [];
  } finally {
    void logApiUsage({
      apiKeyOrIdentifier: "youtube_suggest",
      endpoint: "youtube.suggest",
      quotaCost: 0,
      status,
      errorCode,
      errorMessage,
    });
  }
}
