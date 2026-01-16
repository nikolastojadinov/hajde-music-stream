import { Router } from 'express';
import { browseArtistById, musicSearch, type MusicSearchArtist } from '../services/youtubeMusicClient';
import { ingestArtistBrowse } from '../services/entityIngestion';
import { canRunFullArtistIngest } from '../services/artistIngestGuard';
import { runFullArtistIngest } from '../services/fullArtistIngest';
import { normalizeArtistKey } from '../utils/artistKey';

const router = Router();

const normalizeString = (value: unknown): string => (typeof value === 'string' ? value.trim() : '');
const normalizeLoose = (value: unknown): string => normalizeString(value).toLowerCase().replace(/[^a-z0-9]+/g, '');
const looksLikeBrowseId = (value: string): boolean => /^(OLAK|PL|VL|RD|MP|UU|LL|UC|OL|RV)[A-Za-z0-9_-]+$/i.test(value);

const containsWords = (value: string, words: string[]): boolean => {
  const lower = normalizeString(value).toLowerCase();
  return words.some((w) => lower.includes(w));
};

function pickBestArtistMatch(artists: MusicSearchArtist[], query: string): MusicSearchArtist | null {
  const q = normalizeLoose(query);
  if (!q) return null;

  return (
    artists
      .map((artist) => {
        const nameNorm = normalizeLoose(artist.name);
        const subtitle = normalizeString((artist as any).subtitle || (artist as any).channelTitle || '');
        let score = 0;
        if (containsWords(subtitle, ['profile'])) score -= 1000;
        if (nameNorm === q) score += 200;
        if (nameNorm.includes(q) || q.includes(nameNorm)) score += 40;
        if (artist.isOfficial) score += 40;
        if (containsWords(artist.name, ['tribute', 'cover'])) score -= 120;
        if (containsWords(subtitle, ['tribute', 'cover'])) score -= 80;
        return { artist, score };
      })
      .filter((entry) => entry.score > 0)
      .sort((a, b) => b.score - a.score)[0]?.artist ?? null
  );
}

async function resolveArtistBrowseId(query: string): Promise<string | null> {
  const base = normalizeString(query);
  if (!base) return null;

  const variants = Array.from(
    new Set(
      [
        base,
        base.replace(/[\\/]+/g, ' '),
        base.replace(/[^a-z0-9]+/gi, ' ').trim(),
        base.replace(/[^a-z0-9]+/gi, ''),
      ].filter(Boolean),
    ),
  );

  for (const variant of variants) {
    const search = await musicSearch(variant);
    const tracks = Array.isArray(search.tracks) ? search.tracks : [];
    const artistHints = tracks
      .map((t: any) => normalizeString(t.artist || t.subtitle || ''))
      .filter(Boolean);

    const artists = search.artists || [];
    const bestDirect = pickBestArtistMatch(artists, variant);
    if (bestDirect && looksLikeBrowseId(bestDirect.id)) return bestDirect.id;

    for (const hint of artistHints) {
      const hinted = pickBestArtistMatch(artists, hint);
      if (hinted && looksLikeBrowseId(hinted.id)) return hinted.id;
    }
  }

  return null;
}

router.get('/', async (req, res) => {
  const browseId = normalizeString((req.query.browseId as string) || (req.query.id as string));
  if (!browseId) {
    return res.status(400).json({ error: 'browse_id_required' });
  }

  try {
    let targetId = browseId;

    if (!looksLikeBrowseId(targetId)) {
      const resolved = await resolveArtistBrowseId(targetId);
      if (!resolved) return res.status(400).json({ error: 'browse_id_invalid' });
      targetId = resolved;
    }

    const data = await browseArtistById(targetId);
    let ingestStatus: 'ok' | 'skipped' | 'error' = 'skipped';
    let ingestError: string | null = null;
    const artistKey = normalizeArtistKey(data?.artist?.name ?? '') || null;
    const source: 'direct' = 'direct';

    if (data) {
      try {
        await ingestArtistBrowse(data);
        ingestStatus = 'ok';
      } catch (ingestErr: any) {
        ingestStatus = 'error';
        ingestError = ingestErr?.message || 'ingest_failed';
        console.error('[browse/artist] ingest failed', { browseId: targetId, message: ingestError });
      }

      if (artistKey) {
        try {
          const guard = await canRunFullArtistIngest(artistKey);
          if (guard.allowed) {
            console.info(`[full-artist-ingest] trigger artist_key=${artistKey} browse_id=${targetId}`);
            void runFullArtistIngest({ artistKey, browseId: targetId, source }).catch((err: any) => {
              console.error('[full-artist-ingest] orchestrator failed', {
                artistKey,
                browseId: targetId,
                message: err?.message || String(err),
              });
            });
          } else {
            console.info(`[full-artist-ingest] skip artist_key=${artistKey} reason=${guard.reason}`);
          }
        } catch (guardErr: any) {
          console.error('[full-artist-ingest] guard failed', { artistKey, message: guardErr?.message || String(guardErr) });
        }
      }
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
      ingest_status: ingestStatus,
      ingest_error: ingestError,
    };

    res.set('Cache-Control', 'no-store');
    return res.json(payload);
  } catch (err: any) {
    console.error('[browse/artist] failed', { browseId, message: err?.message });
    return res.status(500).json({ error: 'artist_browse_failed' });
  }
});

export default router;
