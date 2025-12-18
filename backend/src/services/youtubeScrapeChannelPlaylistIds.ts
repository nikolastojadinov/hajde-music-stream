function normalizeString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function looksLikePlaylistId(value: string): boolean {
  // YouTube playlist IDs commonly look like:
  // - PLxxxxxxxxxxxxxxxxxxxxxxxx (channel/user playlists)
  // - OLAK5uyxxxxxxxxxxxxxxxxxxx (auto-generated album playlists)
  const v = normalizeString(value);
  if (!v) return false;
  return v.startsWith("PL") || v.startsWith("OLAK5uy");
}

export async function youtubeScrapeChannelPlaylistIds(
  youtube_channel_id: string,
  opts?: { max?: number | null }
): Promise<string[]> {
  const channelId = normalizeString(youtube_channel_id);
  if (!channelId) return [];

  const maxRaw = opts?.max;
  const max = typeof maxRaw === "number" && Number.isFinite(maxRaw) ? Math.max(0, Math.trunc(maxRaw)) : null;
  if (max === 0) return [];

  // Use the canonical channel playlists page. For Topic channels, this is often the
  // only place where "Albums & Singles" shelves expose playlist IDs.
  const url = `https://www.youtube.com/channel/${encodeURIComponent(channelId)}/playlists`;

  try {
    const response = await fetch(url, {
      method: "GET",
      redirect: "follow",
      headers: {
        "Accept": "text/html,application/xhtml+xml",
        "Accept-Language": "en-US,en;q=0.9",
        // Basic UA helps avoid some bot heuristics.
        "User-Agent": "Mozilla/5.0 (X11; Linux x86_64) HajdeMusicIngest/1.0",
      },
    });

    if (!response.ok) return [];

    const html = await response.text().catch(() => "");
    if (!html) return [];

    const ids: string[] = [];
    const seen = new Set<string>();

    // The HTML contains large JSON blobs. The playlist IDs show up as:
    //   "playlistId":"PL..." or "playlistId":"OLAK5uy..."
    const re = /"playlistId"\s*:\s*"([^"]+)"/g;
    let match: RegExpExecArray | null;

    while ((match = re.exec(html)) !== null) {
      const playlistId = normalizeString(match[1]);
      if (!looksLikePlaylistId(playlistId)) continue;
      if (seen.has(playlistId)) continue;

      seen.add(playlistId);
      ids.push(playlistId);

      if (max !== null && ids.length >= max) break;
    }

    return ids;
  } catch {
    return [];
  }
}
