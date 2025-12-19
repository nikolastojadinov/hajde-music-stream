import { logApiUsage } from './apiUsageLogger';

export type SpotifyArtist = {
  id: string;
  name: string;
  imageUrl?: string;
};

export type SpotifyAlbum = {
  id: string;
  name: string;
  artistName?: string;
  imageUrl?: string;
};

export type SpotifyTrack = {
  id: string;
  name: string;
  artistName?: string;
  durationMs: number;
  imageUrl?: string;
};

export type SpotifyPlaylist = {
  id: string;
  name: string;
  ownerName?: string;
  imageUrl?: string;
};

export type SpotifySearchResult = {
  artists: SpotifyArtist[];
  albums: SpotifyAlbum[];
  tracks: SpotifyTrack[];
  playlists: SpotifyPlaylist[];
};

const EMPTY_RESULT: SpotifySearchResult = { artists: [], albums: [], tracks: [], playlists: [] };

type TokenCache = {
  accessToken: string;
  expiresAtMs: number;
};

let tokenCache: TokenCache | null = null;

function nowMs(): number {
  return Date.now();
}

function getClientCredentials(): { clientId: string; clientSecret: string } {
  const clientId = process.env.SPOTIFY_CLIENT_ID;
  const clientSecret = process.env.SPOTIFY_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    throw new Error('Spotify token fetch failed');
  }

  return { clientId, clientSecret };
}

function firstImageUrl(images: unknown): string | undefined {
  if (!Array.isArray(images)) return undefined;
  for (const img of images) {
    if (img && typeof img === 'object' && 'url' in img) {
      const url = (img as any).url;
      if (typeof url === 'string' && url.length > 0) return url;
    }
  }
  return undefined;
}

async function fetchClientCredentialsToken(): Promise<TokenCache> {
  const { clientId, clientSecret } = getClientCredentials();
  const basic = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');

  const response = await fetch('https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers: {
      Authorization: `Basic ${basic}`,
      'Content-Type': 'application/x-www-form-urlencoded',
      Accept: 'application/json',
    },
    body: new URLSearchParams({ grant_type: 'client_credentials' }),
  });

  if (!response.ok) {
    throw new Error('Spotify token fetch failed');
  }

  const json: any = await response.json().catch(() => null);
  const accessToken = typeof json?.access_token === 'string' ? json.access_token : null;
  const expiresInSec = typeof json?.expires_in === 'number' ? json.expires_in : null;

  if (!accessToken || !expiresInSec) {
    throw new Error('Spotify token fetch failed');
  }

  return {
    accessToken,
    expiresAtMs: nowMs() + expiresInSec * 1000,
  };
}

async function getAccessToken(): Promise<string> {
  const safetyWindowMs = 60_000;
  const now = nowMs();

  if (tokenCache && tokenCache.expiresAtMs - now > safetyWindowMs) {
    return tokenCache.accessToken;
  }

  tokenCache = await fetchClientCredentialsToken();
  return tokenCache.accessToken;
}

export async function spotifySearch(q: string): Promise<SpotifySearchResult> {
  const query = typeof q === 'string' ? q.trim() : '';
  if (query.length < 2) {
    return EMPTY_RESULT;
  }

  const { clientId } = getClientCredentials();
  let status: 'ok' | 'error' = 'ok';
  let errorCode: string | null = null;
  let errorMessage: string | null = null;

  try {
    const token = await getAccessToken();

    const url = new URL('https://api.spotify.com/v1/search');
    url.searchParams.set('q', query);
    url.searchParams.set('type', 'artist,album,track,playlist');
    url.searchParams.set('limit', '5');

    const response = await fetch(url.toString(), {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/json',
      },
    });

    if (!response.ok) {
      status = 'error';
      errorCode = String(response.status);
      errorMessage = 'Spotify search failed';
      throw new Error('Spotify search failed');
    }

    const json: any = await response.json().catch(() => null);

    const artists: SpotifyArtist[] = (json?.artists?.items ?? [])
      .filter((a: any) => a && typeof a === 'object' && typeof a.id === 'string' && typeof a.name === 'string')
      .slice(0, 5)
      .map((a: any) => {
        const imageUrl = firstImageUrl(a.images);
        const out: SpotifyArtist = { id: a.id, name: a.name };
        if (imageUrl) out.imageUrl = imageUrl;
        return out;
      });

    const albums: SpotifyAlbum[] = (json?.albums?.items ?? [])
      .filter((a: any) => a && typeof a === 'object' && typeof a.id === 'string' && typeof a.name === 'string')
      .slice(0, 5)
      .map((a: any) => {
        const imageUrl = firstImageUrl(a.images);
        const artistName = typeof a?.artists?.[0]?.name === 'string' ? a.artists[0].name : undefined;
        const out: SpotifyAlbum = { id: a.id, name: a.name };
        if (artistName) out.artistName = artistName;
        if (imageUrl) out.imageUrl = imageUrl;
        return out;
      });

    const tracks: SpotifyTrack[] = (json?.tracks?.items ?? [])
      .filter((t: any) => t && typeof t === 'object' && typeof t.id === 'string' && typeof t.name === 'string')
      .slice(0, 5)
      .map((t: any) => {
        const durationMs = typeof t.duration_ms === 'number' ? t.duration_ms : 0;
        const artistName = typeof t?.artists?.[0]?.name === 'string' ? t.artists[0].name : undefined;
        const imageUrl = firstImageUrl(t?.album?.images);
        const out: SpotifyTrack = { id: t.id, name: t.name, durationMs };
        if (artistName) out.artistName = artistName;
        if (imageUrl) out.imageUrl = imageUrl;
        return out;
      });

    const playlists: SpotifyPlaylist[] = (json?.playlists?.items ?? [])
      .filter((p: any) => p && typeof p === 'object' && typeof p.id === 'string' && typeof p.name === 'string')
      .slice(0, 5)
      .map((p: any) => {
        const imageUrl = firstImageUrl(p.images);
        const ownerName = typeof p?.owner?.display_name === 'string' ? p.owner.display_name : undefined;
        const out: SpotifyPlaylist = { id: p.id, name: p.name };
        if (ownerName) out.ownerName = ownerName;
        if (imageUrl) out.imageUrl = imageUrl;
        return out;
      });

    return { artists, albums, tracks, playlists };
  } catch (err) {
    if (err instanceof Error && err.message === 'Spotify search failed') {
      throw err;
    }

    status = 'error';
    errorMessage = errorMessage ?? 'Spotify search failed';
    throw new Error('Spotify search failed');
  } finally {
    void logApiUsage({
      apiKeyOrIdentifier: clientId,
      endpoint: 'spotify.search',
      quotaCost: 0,
      status,
      errorCode,
      errorMessage,
    });
  }
}

export async function spotifySuggest(q: string): Promise<string[]> {
  const query = typeof q === 'string' ? q.trim() : '';
  if (query.length < 2) return [];

  const { clientId } = getClientCredentials();
  let status: 'ok' | 'error' = 'ok';
  let errorCode: string | null = null;
  let errorMessage: string | null = null;

  try {
    const token = await getAccessToken();

    const url = new URL('https://api.spotify.com/v1/search');
    url.searchParams.set('q', query);
    url.searchParams.set('type', 'artist');
    url.searchParams.set('limit', '10');

    const response = await fetch(url.toString(), {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/json',
      },
    });

    if (!response.ok) {
      status = 'error';
      errorCode = String(response.status);
      errorMessage = 'Spotify suggest failed';
      throw new Error('Spotify suggest failed');
    }

    const json: any = await response.json().catch(() => null);
    const items: any[] = Array.isArray(json?.artists?.items) ? json.artists.items : [];

    const out = items
      .filter((a: any) => a && typeof a === 'object' && typeof a.name === 'string')
      .map((a: any) => String(a.name).trim())
      .filter(Boolean);

    // De-dupe while preserving order.
    const seen = new Set<string>();
    const deduped: string[] = [];
    for (const name of out) {
      const key = name.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      deduped.push(name);
      if (deduped.length >= 10) break;
    }

    return deduped;
  } catch (err) {
    if (err instanceof Error && err.message === 'Spotify suggest failed') {
      throw err;
    }

    status = 'error';
    errorMessage = errorMessage ?? 'Spotify suggest failed';
    throw new Error('Spotify suggest failed');
  } finally {
    void logApiUsage({
      apiKeyOrIdentifier: clientId,
      endpoint: 'spotify.suggest',
      quotaCost: 0,
      status,
      errorCode,
      errorMessage,
    });
  }
}
