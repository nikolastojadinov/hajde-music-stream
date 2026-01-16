import { browseArtistById, type ArtistBrowse } from '../../services/youtubeMusicClient';

export type NormalizedArtistBrowse = ArtistBrowse & {
  albums: NonNullable<ArtistBrowse['albums']>;
  playlists: NonNullable<ArtistBrowse['playlists']>;
  topSongs: NonNullable<ArtistBrowse['topSongs']>;
};

function normalizeId(value: string): string {
  return typeof value === 'string' ? value.trim() : '';
}

export async function fetchArtistBrowseById(browseId: string): Promise<NormalizedArtistBrowse | null> {
  const normalized = normalizeId(browseId);
  if (!normalized) return null;

  const browse = await browseArtistById(normalized);
  if (!browse) return null;

  return {
    ...browse,
    albums: Array.isArray(browse.albums) ? browse.albums : [],
    playlists: Array.isArray(browse.playlists) ? browse.playlists : [],
    topSongs: Array.isArray(browse.topSongs) ? browse.topSongs : [],
  };
}