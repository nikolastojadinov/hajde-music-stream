function normalizeString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function looksLikeVideoId(value: string): boolean {
  // Typical YouTube video IDs are 11 chars, url-safe.
  const v = normalizeString(value);
  return /^[A-Za-z0-9_-]{11}$/.test(v);
}

export async function youtubeScrapePlaylistVideoIds(
  youtube_playlist_id: string,
  opts?: { max?: number | null }
): Promise<string[]> {
  const playlistId = normalizeString(youtube_playlist_id);
  if (!playlistId) return [];

  const maxRaw = opts?.max;
  const max = typeof maxRaw === "number" && Number.isFinite(maxRaw) ? Math.max(0, Math.trunc(maxRaw)) : null;
  if (max === 0) return [];

  const url = `https://www.youtube.com/playlist?list=${encodeURIComponent(playlistId)}&hl=en&gl=US`;

  try {
    const response = await fetch(url, {
      method: "GET",
      redirect: "follow",
      headers: {
        "Accept": "text/html,application/xhtml+xml",
        "Accept-Language": "en-US,en;q=0.9",
        "User-Agent": "Mozilla/5.0 (X11; Linux x86_64) HajdeMusicIngest/1.0",
        Cookie: "CONSENT=YES+1;",
      },
    });

    if (!response.ok) return [];

    const html = await response.text().catch(() => "");
    if (!html) return [];

    if (html.includes("consent.youtube.com") || html.includes("Before you continue")) {
      console.warn("[youtubeScrapePlaylistVideoIds] consent wall", { youtube_playlist_id: playlistId });
      return [];
    }

    const ids: string[] = [];
    const seen = new Set<string>();

    // Playlist page contains large JSON blobs with video IDs like:
    //   "videoId":"dQw4w9WgXcQ"
    const re = /"videoId"\s*:\s*"([^"]+)"/g;
    let match: RegExpExecArray | null;

    while ((match = re.exec(html)) !== null) {
      const videoId = normalizeString(match[1]);
      if (!looksLikeVideoId(videoId)) continue;
      if (seen.has(videoId)) continue;

      seen.add(videoId);
      ids.push(videoId);

      if (max !== null && ids.length >= max) break;
    }

    return ids;
  } catch {
    return [];
  }
}
