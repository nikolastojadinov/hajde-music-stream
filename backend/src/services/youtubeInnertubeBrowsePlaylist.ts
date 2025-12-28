const CONSENT_COOKIES = "CONSENT=YES+1; SOCS=CAESHAgBEhIaZ29vZ2xlLmNvbS9jb25zZW50L2Jhc2ljLzIiDFNvaURtdXhSNVQ1ag==; PREF=f1=50000000&hl=en";

function normalizeString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function looksLikeVideoId(value: string): boolean {
  const v = normalizeString(value);
  return /^[A-Za-z0-9_-]{11}$/.test(v);
}

function takeFirstMatch(html: string, pattern: RegExp): string | null {
  const m = pattern.exec(html);
  return m && m[1] ? normalizeString(m[1]) : null;
}

function extractVideoIdsFromTree(root: any, max: number | null): string[] {
  const out: string[] = [];
  const seen = new Set<string>();

  function walk(node: any): void {
    if (max !== null && out.length >= max) return;
    if (!node) return;

    if (Array.isArray(node)) {
      for (const item of node) {
        if (max !== null && out.length >= max) break;
        walk(item);
      }
      return;
    }

    if (typeof node !== "object") return;

    const pvr = (node as any)?.playlistVideoRenderer;
    if (pvr) {
      const videoId = normalizeString(pvr?.videoId);
      if (looksLikeVideoId(videoId) && !seen.has(videoId)) {
        seen.add(videoId);
        out.push(videoId);
      }
    }

    const ppvr = (node as any)?.playlistPanelVideoRenderer;
    if (ppvr) {
      const videoId = normalizeString(ppvr?.videoId);
      if (looksLikeVideoId(videoId) && !seen.has(videoId)) {
        seen.add(videoId);
        out.push(videoId);
      }
    }

    for (const value of Object.values(node)) {
      if (max !== null && out.length >= max) break;
      walk(value);
    }
  }

  walk(root);
  return out;
}

type InnertubeConfig = {
  apiKey: string;
  clientVersion: string | null;
  visitorData: string | null;
};

async function fetchInnertubeConfigFrom(url: string): Promise<InnertubeConfig | null> {
  try {
    const response = await fetch(url, {
      method: "GET",
      // Prevent infinite consent redirects; treat non-200 as failure and let caller log.
      redirect: "manual",
      headers: {
        Accept: "text/html,application/xhtml+xml",
        "Accept-Language": "en-US,en;q=0.9",
        "User-Agent": "Mozilla/5.0 (X11; Linux x86_64) HajdeMusicIngest/1.0",
        Cookie: CONSENT_COOKIES,
      },
    });

    if (response.type === "opaqueredirect" || response.status >= 300) {
      console.info("[youtubeInnertubeBrowsePlaylist] config_fetch_http_error", {
        url,
        status: response.status,
        redirected: response.type,
      });
      return null;
    }

    const html = await response.text().catch(() => "");
    if (!html) return null;
    if (html.includes("consent.youtube.com") || html.includes("Before you continue")) {
      console.info("[youtubeInnertubeBrowsePlaylist] consent_wall", { url });
      return null;
    }

    const apiKey = takeFirstMatch(html, /"INNERTUBE_API_KEY"\s*:\s*"([^"]+)"/);
    if (!apiKey) return null;

    const clientVersion =
      takeFirstMatch(html, /"INNERTUBE_CLIENT_VERSION"\s*:\s*"([^"]+)"/) ||
      takeFirstMatch(html, /"clientVersion"\s*:\s*"([^"]+)"/);

    const visitorData =
      takeFirstMatch(html, /"VISITOR_DATA"\s*:\s*"([^"]+)"/) ||
      takeFirstMatch(html, /"visitorData"\s*:\s*"([^"]+)"/);

    return { apiKey, clientVersion, visitorData };
  } catch (err: any) {
    console.info("[youtubeInnertubeBrowsePlaylist] config_fetch_exception", {
      url,
      message: err?.message,
    });
    return null;
  }
}

async function fetchInnertubeConfig(): Promise<InnertubeConfig | null> {
  // Try music first (WEB_REMIX), then www as a fallback.
  return (await fetchInnertubeConfigFrom("https://music.youtube.com/?hl=en&gl=US"))
    || (await fetchInnertubeConfigFrom("https://www.youtube.com/?hl=en&gl=US"));
}

export async function youtubeInnertubeBrowsePlaylistVideoIds(
  playlistIdRaw: string,
  opts?: { max?: number | null }
): Promise<string[]> {
  const playlistId = normalizeString(playlistIdRaw);
  if (!playlistId) return [];

  const maxRaw = opts?.max;
  const max = typeof maxRaw === "number" && Number.isFinite(maxRaw) ? Math.max(0, Math.trunc(maxRaw)) : null;
  if (max === 0) return [];

  const browseId = playlistId.startsWith("VL") ? playlistId : `VL${playlistId}`;
  const config = await fetchInnertubeConfig();
  if (!config) return [];

  const clientVersion = config.clientVersion || "1.20241210.01.00";
  const payload = {
    context: {
      client: {
        clientName: "WEB_REMIX",
        clientVersion,
        hl: "en",
        gl: "US",
        visitorData: config.visitorData || undefined,
      },
      user: { enableSafetyMode: false },
    },
    browseId,
  };

  const url = `https://music.youtube.com/youtubei/v1/browse?prettyPrint=false&key=${encodeURIComponent(config.apiKey)}`;
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        "Accept-Language": "en-US,en;q=0.9",
        "User-Agent": "Mozilla/5.0 (X11; Linux x86_64) HajdeMusicIngest/1.0",
        Origin: "https://music.youtube.com",
        Referer: `https://music.youtube.com/playlist?list=${encodeURIComponent(playlistId)}`,
        Cookie: CONSENT_COOKIES,
        "X-Goog-Visitor-Id": config.visitorData || "",
      },
      body: JSON.stringify(payload),
      });

    if (!response.ok) {
      console.info("[youtubeInnertubeBrowsePlaylist] browse_http_error", {
        status: response.status,
        playlistId,
      });
      return [];
    }
    const json = await response.json().catch(() => null);
    if (!json || typeof json !== "object") {
      console.info("[youtubeInnertubeBrowsePlaylist] browse_invalid_json", { playlistId });
      return [];
    }

    const ids = extractVideoIdsFromTree(json, max);
    if (ids.length === 0) {
      console.info("[youtubeInnertubeBrowsePlaylist] browse_empty", { playlistId });
    }
    return ids;
  } catch (err: any) {
    console.info("[youtubeInnertubeBrowsePlaylist] browse_exception", {
      playlistId,
      message: err?.message,
    });
    return [];
  }
}
