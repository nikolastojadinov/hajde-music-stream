import { getSupabaseAdmin } from './supabaseClient';

export type LinkArtist = {
  normalizedName: string;
  rawName?: string | null;
  candidateKey?: string | null;
};

export type ArtistTrackLink = {
  trackId: string;
  artists: LinkArtist[];
};

function normalize(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeLookupName(value: string): string {
  return normalize(value).toLowerCase();
}

async function loadCanonicalArtistMap(normalizedNames: string[]): Promise<Record<string, string>> {
  if (!normalizedNames.length) return {};
  const client = getSupabaseAdmin();
  const { data, error } = await client
    .from('artists')
    .select('artist_key, normalized_name')
    .in('normalized_name', normalizedNames);

  if (error) {
    console.error('[linkArtistTracks] artist_lookup_failed', { message: error.message });
    return {};
  }

  const map: Record<string, string> = {};
  (data || []).forEach((row: any) => {
    const normalized = normalizeLookupName(row?.normalized_name);
    const key = normalize(row?.artist_key);
    if (normalized && key && !map[normalized]) {
      map[normalized] = key;
    }
  });

  return map;
}

export async function linkArtistTracks(pairs: ArtistTrackLink[]): Promise<number> {
  if (!pairs.length) return 0;

  try {
    const entries: Array<{ trackId: string; normalizedName: string; rawName?: string | null; candidateKey?: string | null }> = [];
    const seen = new Set<string>();

    pairs.forEach((pair) => {
      const trackId = normalize(pair?.trackId);
      if (!trackId) return;

      (pair.artists || []).forEach((artist) => {
        const normalizedName = normalizeLookupName(artist?.normalizedName);
        if (!normalizedName) return;
        const token = `${trackId}-${normalizedName}`;
        if (seen.has(token)) return;
        seen.add(token);
        entries.push({ trackId, normalizedName, rawName: artist?.rawName, candidateKey: artist?.candidateKey });
      });
    });

    if (!entries.length) return 0;

    const normalizedNames = Array.from(new Set(entries.map((e) => e.normalizedName)));
    const canonicalMap = await loadCanonicalArtistMap(normalizedNames);

    const rows: Array<{ artist_key: string; track_id: string }> = [];

    entries.forEach((entry) => {
      const artistKey = canonicalMap[entry.normalizedName];
      if (!artistKey) {
        console.warn('[linkArtistTracks] artist_missing_skip', {
          normalized_name: entry.normalizedName,
          raw_name: entry.rawName ?? null,
          raw_key: entry.candidateKey ?? null,
        });
        return;
      }

      rows.push({ artist_key: artistKey, track_id: entry.trackId });
    });

    if (!rows.length) return 0;

    const client = getSupabaseAdmin();
    const { error } = await client
      .from('artist_tracks')
      .insert(rows, { upsert: true, onConflict: 'artist_key,track_id' });

    if (error) {
      console.error('[linkArtistTracks] artist_tracks_fk_skip', {
        message: error.message,
      });
      return 0;
    }

    rows.forEach((row) => {
      console.info('[linkArtistTracks] artist_tracks_linked', {
        artist_key: row.artist_key,
        track_id: row.track_id,
      });
    });

    return rows.length;
  } catch (err: any) {
    console.error('[linkArtistTracks] failed', { message: err?.message || String(err) });
    return 0;
  }
}
