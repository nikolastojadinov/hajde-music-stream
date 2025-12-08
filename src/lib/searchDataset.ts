import { EXTERNAL_SUPABASE_ANON_KEY, EXTERNAL_SUPABASE_URL } from "@/lib/externalSupabase";

export type SearchDatasetItem =
  | { type: "track"; trackId: string; title: string; artist: string }
  | { type: "artist"; artist: string };

interface RawTrack {
  id: string;
  title: string | null;
  artist: string | null;
}

const CACHE_KEY = "pm_search_cache";
const ETAG_KEY = "pm_search_etag";
const TIMESTAMP_KEY = "pm_search_cache_timestamp";
const REFRESH_INTERVAL_MS = 24 * 60 * 60 * 1000;
const TRACKS_ENDPOINT = `${EXTERNAL_SUPABASE_URL}/rest/v1/tracks?select=id,title,artist`;

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

export const getCachedDataset = (): SearchDatasetItem[] => safeParse(localStorage.getItem(CACHE_KEY));

const shouldRefreshCache = (force?: boolean) => {
  if (force) return true;
  const last = Number(localStorage.getItem(TIMESTAMP_KEY) || 0);
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
