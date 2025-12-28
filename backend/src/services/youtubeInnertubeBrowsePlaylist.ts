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

async function fetchInnertubeConfig(): Promise<{ apiKey: string; clientVersion: string | null } | null> {
  const response = await fetch("https://music.youtube.com/?hl=en&gl=US", {
    method: "GET",
    redirect: "follow",
    headers: {
      Accept: "text/html,application/xhtml+xml",
      "Accept-Language": "en-US,en;q=0.9",
      "User-Agent": "Mozilla/5.0 (X11; Linux x86_64) HajdeMusicIngest/1.0",
      Cookie: CONSENT_COOKIES,
    },
  });

  if (!response.ok) return null;
  const html = await response.text().catch(() => "");
  if (!html || html.includes("consent.youtube.com") || html.includes("Before you continue")) return null;

  const apiKey = takeFirstMatch(html, /"INNERTUBE_API_KEY"\s*:\s*"([^"]+)"/);
  if (!apiKey) return null;

  const clientVersion =
    takeFirstMatch(html, /"INNERTUBE_CLIENT_VERSION"\s*:\s*"([^"]+)"/) ||
    takeFirstMatch(html, /"clientVersion"\s*:\s*"([^"]+)"/);

  return { apiKey, clientVersion };
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
        Referer: "https://music.youtube.com/",
        Cookie: CONSENT_COOKIES,
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) return [];
    const json = await response.json().catch(() => null);
    if (!json || typeof json !== "object") return [];

    const ids = extractVideoIdsFromTree(json, max);
    return ids;
  } catch {
    return [];
  }
}
