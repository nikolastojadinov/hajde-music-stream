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

  const attempts: Array<{ url: string; headers: Record<string, string> }> = [
    {
      url: `https://www.youtube.com/playlist?list=${encodeURIComponent(playlistId)}&hl=en&gl=US`,
      headers: {
        Accept: "text/html,application/xhtml+xml",
        "Accept-Language": "en-US,en;q=0.9",
        "User-Agent": "Mozilla/5.0 (X11; Linux x86_64) HajdeMusicIngest/1.0",
        // CONSENT cookie alone is sometimes not enough; SOCS helps bypass the interstitial.
        Cookie: "CONSENT=YES+1; SOCS=CAESHAgBEhIaZ29vZ2xlLmNvbS9jb25zZW50L2Jhc2ljLzIiDFNvaURtdXhSNVQ1ag==; PREF=f1=50000000&hl=en",
      },
    },
    {
      // PBJ mode often skips the consent HTML; keep same headers.
      url: `https://www.youtube.com/playlist?list=${encodeURIComponent(playlistId)}&hl=en&gl=US&pbj=1`,
      headers: {
        Accept: "application/json,text/html",
        "Accept-Language": "en-US,en;q=0.9",
        "User-Agent": "Mozilla/5.0 (X11; Linux x86_64) HajdeMusicIngest/1.0",
        Cookie: "CONSENT=YES+1; SOCS=CAESHAgBEhIaZ29vZ2xlLmNvbS9jb25zZW50L2Jhc2ljLzIiDFNvaURtdXhSNVQ1ag==; PREF=f1=50000000&hl=en",
        "X-YouTube-Client-Name": "1",
        "X-YouTube-Client-Version": "2.20201021.03.00",
      },
    },
    {
      // music.youtube.com sometimes bypasses consent while keeping the same playlist contents.
      url: `https://music.youtube.com/playlist?list=${encodeURIComponent(playlistId)}&hl=en&gl=US`,
      headers: {
        Accept: "text/html,application/xhtml+xml,application/json",
        "Accept-Language": "en-US,en;q=0.9",
        "User-Agent": "Mozilla/5.0 (X11; Linux x86_64) HajdeMusicIngest/1.0",
        Cookie: "CONSENT=YES+1; SOCS=CAESHAgBEhIaZ29vZ2xlLmNvbS9jb25zZW50L2Jhc2ljLzIiDFNvaURtdXhSNVQ1ag==; PREF=f1=50000000&hl=en",
      },
    },
  ];

  for (const attempt of attempts) {
    try {
      const response = await fetch(attempt.url, {
        method: "GET",
        redirect: "follow",
        headers: attempt.headers,
      });

      if (!response.ok) continue;

      const html = await response.text().catch(() => "");
      if (!html) continue;

      if (html.includes("consent.youtube.com") || html.includes("Before you continue")) {
        console.warn("[youtubeScrapePlaylistVideoIds] consent wall", {
          youtube_playlist_id: playlistId,
          attempt: attempt.url,
        });
        continue;
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

      if (ids.length > 0) return ids;
    } catch {
      continue;
    }
  }

  return [];
}
