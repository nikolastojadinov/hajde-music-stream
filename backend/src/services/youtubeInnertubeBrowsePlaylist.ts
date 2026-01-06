import { CONSENT_COOKIES, fetchInnertubeConfig, type InnertubeConfig } from "./youtubeInnertubeConfig";

function normalizeString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function looksLikeVideoId(value: string): boolean {
  const v = normalizeString(value);
  return /^[A-Za-z0-9_-]{11}$/.test(v);
}

function pickThumbnail(thumbnails?: any): string | null {
  const arr = Array.isArray(thumbnails) ? thumbnails : thumbnails?.thumbnails;
  if (!Array.isArray(arr)) return null;
  for (const t of arr) {
    const url = normalizeString((t as any)?.url);
    if (url) return url;
  }
  return null;
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

export type PlaylistBrowseResult = {
  id: string;
  title: string;
  author?: string | null;
  thumbnailUrl?: string | null;
  videoIds: string[];
};

export async function youtubeInnertubeBrowsePlaylist(
  playlistIdRaw: string,
  opts?: { max?: number | null }
): Promise<PlaylistBrowseResult | null> {
  const playlistId = normalizeString(playlistIdRaw);
  if (!playlistId) return null;

  const maxRaw = opts?.max;
  const max = typeof maxRaw === "number" && Number.isFinite(maxRaw) ? Math.max(0, Math.trunc(maxRaw)) : null;
  if (max === 0) return null;

  const browseId = playlistId.startsWith("VL") ? playlistId : `VL${playlistId}`;
  const config = await fetchInnertubeConfig();
  if (!config) return null;

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
      return null;
    }
    const json = await response.json().catch(() => null);
    if (!json || typeof json !== "object") {
      console.info("[youtubeInnertubeBrowsePlaylist] browse_invalid_json", { playlistId });
      return null;
    }

    const ids = extractVideoIdsFromTree(json, max);
    if (ids.length === 0) {
      console.info("[youtubeInnertubeBrowsePlaylist] browse_empty", { playlistId });
    }
    const header = (json as any)?.header?.musicDetailHeaderRenderer;
    const title = normalizeString(header?.title?.runs?.[0]?.text) || playlistId;
    const author = normalizeString(header?.subtitle?.runs?.[0]?.text) || null;
    const thumb =
      pickThumbnail(header?.thumbnail?.croppedSquareThumbnailRenderer?.thumbnail?.thumbnails) ||
      pickThumbnail(header?.thumbnail?.musicThumbnailRenderer?.thumbnail?.thumbnails);

    return {
      id: playlistId,
      title,
      author,
      thumbnailUrl: thumb,
      videoIds: ids,
    };
  } catch (err: any) {
    console.info("[youtubeInnertubeBrowsePlaylist] browse_exception", {
      playlistId,
      message: err?.message,
    });
    return null;
  }
}
