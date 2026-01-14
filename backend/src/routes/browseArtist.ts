import { Router } from 'express';
import { browseArtistById, musicSearch, type MusicSearchArtist } from '../services/youtubeMusicClient';
import { ingestArtistBrowse } from '../services/entityIngestion';

const router = Router();

const normalizeString = (value: unknown): string => (typeof value === 'string' ? value.trim() : '');
const normalizeLoose = (value: unknown): string => normalizeString(value).toLowerCase().replace(/[^a-z0-9]+/g, '');
const looksLikeBrowseId = (value: string): boolean => /^(OLAK|PL|VL|RD|MP|UU|LL|UC|OL|RV)[A-Za-z0-9_-]+$/i.test(value);

function pickBestArtistMatch(artists: MusicSearchArtist[], query: string): MusicSearchArtist | null {
  const q = normalizeLoose(query);
  if (!q) return null;

  return artists
    .map((artist) => {
      const nameNorm = normalizeLoose(artist.name);
      let score = 0;
      if (nameNorm === q) score += 200;
      if (nameNorm.includes(q) || q.includes(nameNorm)) score += 40;
      if (artist.isOfficial) score += 40;
      return { artist, score };
    })
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score)[0]?.artist ?? null;
}

router.get('/', async (req, res) => {
  const browseId = normalizeString((req.query.browseId as string) || (req.query.id as string));
  if (!browseId) {
    return res.status(400).json({ error: 'browse_id_required' });
  }

  try {
    let targetId = browseId;

    // If the incoming id is not a valid YouTube Music browse id, try to resolve it via search
    if (!looksLikeBrowseId(targetId)) {
      const search = await musicSearch(targetId);
      const best = pickBestArtistMatch(search.artists || [], targetId);
      if (!best || !looksLikeBrowseId(best.id)) {
        return res.status(400).json({ error: 'browse_id_invalid' });
      }
      targetId = best.id;
    }

    const data = await browseArtistById(targetId);
    if (data) {
      await ingestArtistBrowse(data);
    }
    const payload = {
      artistName: data?.artist.name ?? null,
      thumbnails: { avatar: data?.artist.thumbnailUrl ?? null, banner: data?.artist.bannerUrl ?? null },
      topSongs: Array.isArray(data?.topSongs)
        ? data.topSongs
            .map((t) => ({
              id: normalizeString(t.id),
              title: normalizeString(t.title) || 'Untitled',
              imageUrl: t.imageUrl ?? null,
              playCount: t.playCount ?? null,
            }))
            .filter((t) => Boolean(t.id))
        : [],
      albums: Array.isArray(data?.albums)
        ? data.albums
            .map((a) => ({
              id: normalizeString(a.id),
              title: normalizeString(a.title) || 'Album',
              imageUrl: a.imageUrl ?? null,
              year: a.year ?? null,
            }))
            .filter((a) => Boolean(a.id))
        : [],
      playlists: Array.isArray(data?.playlists)
        ? data.playlists
            .map((p) => ({
              id: normalizeString(p.id),
              title: normalizeString(p.title) || 'Playlist',
              imageUrl: p.imageUrl ?? null,
            }))
            .filter((p) => Boolean(p.id))
        : [],
    };

    res.set('Cache-Control', 'no-store');
    return res.json(payload);
  } catch (err: any) {
    console.error('[browse/artist] failed', { browseId, message: err?.message });
    return res.status(500).json({ error: 'artist_browse_failed' });
  }
});

export default router;
