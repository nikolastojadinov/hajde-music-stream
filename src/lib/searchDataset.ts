import { EXTERNAL_SUPABASE_ANON_KEY, EXTERNAL_SUPABASE_URL } from "@/lib/externalSupabase";

export type SearchDatasetItem =
  | { type: "track"; trackId: string; title: string; artist: string }
  | {
      type: "artist";
      artist: string;
      label?: string;
      source?: "tracks" | "artists_search";
      isPopular?: boolean;
    };

interface RawTrack {
  id: string;
  title: string | null;
  artist: string | null;
}

interface RawArtistSearch {
  artist: string | null;
  popularity_tier: string | null;
}

const CACHE_KEY = "pm_search_cache";
const ETAG_KEY = "pm_search_etag";
const TIMESTAMP_KEY = "pm_search_cache_timestamp";
const ARTISTS_SEARCH_CACHE_KEY = "pm_search_artists_search_cache";
const ARTISTS_SEARCH_ETAG_KEY = "pm_search_artists_search_etag";
const ARTISTS_SEARCH_TIMESTAMP_KEY = "pm_search_artists_search_cache_timestamp";
const REFRESH_INTERVAL_MS = 24 * 60 * 60 * 1000;
const TRACKS_ENDPOINT = `${EXTERNAL_SUPABASE_URL}/rest/v1/tracks?select=id,title,artist`;
const ARTISTS_SEARCH_ENDPOINT = `${EXTERNAL_SUPABASE_URL}/rest/v1/artists_search?select=artist,popularity_tier`;

type LoadOptions = {
  force?: boolean;
};

const safeParse = (value: string | null): SearchDatasetItem[] => {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    if (Array.isArray(parsed)) {
      return parsed as SearchDatasetItem[];
    }
  } catch (_) {
    localStorage.removeItem(CACHE_KEY);
  }
  return [];
};

const safeParseArtistsSearch = (value: string | null): SearchDatasetItem[] => {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    if (Array.isArray(parsed)) {
      return parsed as SearchDatasetItem[];
    }
  } catch (_) {
    localStorage.removeItem(ARTISTS_SEARCH_CACHE_KEY);
  }
  return [];
};

const buildDataset = (tracks: RawTrack[]): SearchDatasetItem[] => {
  const dataset: SearchDatasetItem[] = [];
  const artistSet = new Set<string>();

  tracks.forEach((track) => {
    if (track.id && track.title && track.artist) {
      dataset.push({
        type: "track",
        trackId: track.id,
        title: track.title,
        artist: track.artist,
      });
      artistSet.add(track.artist);
    }
  });

  Array.from(artistSet).forEach((artist) => {
    dataset.push({ type: "artist", artist });
  });

  return dataset;
};

const updateCache = (dataset: SearchDatasetItem[], etag?: string | null) => {
  localStorage.setItem(CACHE_KEY, JSON.stringify(dataset));
  localStorage.setItem(TIMESTAMP_KEY, String(Date.now()));
  if (etag) {
    localStorage.setItem(ETAG_KEY, etag);
  }
};

const updateArtistsSearchCache = (dataset: SearchDatasetItem[], etag?: string | null) => {
  localStorage.setItem(ARTISTS_SEARCH_CACHE_KEY, JSON.stringify(dataset));
  localStorage.setItem(ARTISTS_SEARCH_TIMESTAMP_KEY, String(Date.now()));
  if (etag) {
    localStorage.setItem(ARTISTS_SEARCH_ETAG_KEY, etag);
  }
};

export const getCachedDataset = (): SearchDatasetItem[] => safeParse(localStorage.getItem(CACHE_KEY));

export const getCachedArtistsSearchDataset = (): SearchDatasetItem[] =>
  safeParseArtistsSearch(localStorage.getItem(ARTISTS_SEARCH_CACHE_KEY));

const shouldRefreshCache = (force?: boolean) => {
  if (force) return true;
  const last = Number(localStorage.getItem(TIMESTAMP_KEY) || 0);
  return !last || Date.now() - last > REFRESH_INTERVAL_MS;
};

const shouldRefreshArtistsSearchCache = (force?: boolean) => {
  if (force) return true;
  const last = Number(localStorage.getItem(ARTISTS_SEARCH_TIMESTAMP_KEY) || 0);
  return !last || Date.now() - last > REFRESH_INTERVAL_MS;
};

export const loadSearchDataset = async (options: LoadOptions = {}): Promise<SearchDatasetItem[]> => {
  const cached = getCachedDataset();
  const force = options.force ?? false;

  if (!shouldRefreshCache(force) && cached.length) {
    return cached;
  }

  const etag = localStorage.getItem(ETAG_KEY) || undefined;

  const headers: Record<string, string> = {
    apikey: EXTERNAL_SUPABASE_ANON_KEY,
    Authorization: `Bearer ${EXTERNAL_SUPABASE_ANON_KEY}`,
    Prefer: "return=representation",
    Accept: "application/json",
  };

  if (etag) {
    headers["If-None-Match"] = etag;
  }

  const response = await fetch(TRACKS_ENDPOINT, { headers });

  if (response.status === 304) {
    localStorage.setItem(TIMESTAMP_KEY, String(Date.now()));
    if (cached.length) {
      return cached;
    }
    localStorage.removeItem(ETAG_KEY);
    return loadSearchDataset({ force: true });
  }

  if (!response.ok) {
    throw new Error(`Failed to load search dataset (${response.status})`);
  }

  const tracks: RawTrack[] = await response.json();
  const dataset = buildDataset(tracks);
  const nextEtag = response.headers.get("etag");

  updateCache(dataset, nextEtag);

  return dataset;
};

export const loadArtistsSearchDataset = async (options: LoadOptions = {}): Promise<SearchDatasetItem[]> => {
  const cached = getCachedArtistsSearchDataset();
  const force = options.force ?? false;

  if (!shouldRefreshArtistsSearchCache(force) && cached.length) {
    return cached;
  }

  const etag = localStorage.getItem(ARTISTS_SEARCH_ETAG_KEY) || undefined;

  const headers: Record<string, string> = {
    apikey: EXTERNAL_SUPABASE_ANON_KEY,
    Authorization: `Bearer ${EXTERNAL_SUPABASE_ANON_KEY}`,
    Prefer: "return=representation",
    Accept: "application/json",
  };

  if (etag) {
    headers["If-None-Match"] = etag;
  }

  const response = await fetch(ARTISTS_SEARCH_ENDPOINT, { headers });

  if (response.status === 304) {
    localStorage.setItem(ARTISTS_SEARCH_TIMESTAMP_KEY, String(Date.now()));
    if (cached.length) {
      return cached;
    }
    localStorage.removeItem(ARTISTS_SEARCH_ETAG_KEY);
    return loadArtistsSearchDataset({ force: true });
  }

  if (!response.ok) {
    throw new Error(`Failed to load artists_search dataset (${response.status})`);
  }

  const rows: RawArtistSearch[] = await response.json();
  const seen = new Set<string>();

  const dataset: SearchDatasetItem[] = [];
  rows.forEach((row) => {
    const artist = row.artist?.trim();
    if (!artist) return;
    const key = artist.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);

    dataset.push({
      type: "artist",
      artist,
      label: artist,
      source: "artists_search",
      isPopular: row.popularity_tier === "popular",
    });
  });

  const nextEtag = response.headers.get("etag");
  updateArtistsSearchCache(dataset, nextEtag);

  return dataset;
};
