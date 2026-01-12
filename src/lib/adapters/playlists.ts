export type UIPlaylist = {
  browseId: string;
  title: string;
  subtitle: string | null;
  imageUrl: string | null;
  badge?: string | null;
  navState: {
    playlistId: string;
    playlistTitle: string;
    playlistCover: string | null;
  };
};

const normalizeId = (...candidates: Array<string | null | undefined>): string => {
  for (const candidate of candidates) {
    if (typeof candidate !== "string") continue;
    const trimmed = candidate.trim();
    if (trimmed.length > 0) return trimmed;
  }
  return "";
};

const normalizeText = (value: string | null | undefined, fallback: string | null = ""): string | null => {
  if (typeof value !== "string") return fallback;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : fallback;
};

export function adaptTrendingSnapshotItem(item: { id: string; external_id: string | null; title: string; subtitle: string; imageUrl: string | null }): UIPlaylist | null {
  const browseId = normalizeId(item.external_id, item.id);
  if (!browseId) return null;

  return {
    browseId,
    title: normalizeText(item.title),
    subtitle: normalizeText(item.subtitle, null),
    imageUrl: item.imageUrl ?? null,
    badge: "Playlist",
    navState: {
      playlistId: browseId,
      playlistTitle: normalizeText(item.title),
      playlistCover: item.imageUrl ?? null,
    },
  };
}

export function adaptMostPopularSnapshotItem(item: { id: string; external_id: string | null; title: string; subtitle: string; imageUrl: string | null }): UIPlaylist | null {
  const browseId = normalizeId(item.external_id, item.id);
  if (!browseId) return null;

  return {
    browseId,
    title: normalizeText(item.title),
    subtitle: normalizeText(item.subtitle, null),
    imageUrl: item.imageUrl ?? null,
    badge: "Playlist",
    navState: {
      playlistId: browseId,
      playlistTitle: normalizeText(item.title),
      playlistCover: item.imageUrl ?? null,
    },
  };
}

export function adaptNewReleasesSnapshotItem(item: { id: string; external_id: string | null; title: string; subtitle: string; imageUrl: string | null }): UIPlaylist | null {
  const browseId = normalizeId(item.external_id, item.id);
  if (!browseId) return null;

  return {
    browseId,
    title: normalizeText(item.title),
    subtitle: normalizeText(item.subtitle, null),
    imageUrl: item.imageUrl ?? null,
    badge: "Playlist",
    navState: {
      playlistId: browseId,
      playlistTitle: normalizeText(item.title),
      playlistCover: item.imageUrl ?? null,
    },
  };
}

export function adaptSearchPlaylistResult(item: { id: string; title: string; subtitle?: string; imageUrl?: string; endpointPayload: string }): UIPlaylist | null {
  const browseId = normalizeId(item.endpointPayload, item.id);
  if (!browseId) return null;

  return {
    browseId,
    title: normalizeText(item.title),
    subtitle: normalizeText(item.subtitle ?? null, null),
    imageUrl: item.imageUrl ?? null,
    badge: "Playlist",
    navState: {
      playlistId: browseId,
      playlistTitle: normalizeText(item.title),
      playlistCover: item.imageUrl ?? null,
    },
  };
}
