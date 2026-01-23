import {
  isArtistResult,
  musicSearch,
  scoreArtistMatch,
  type SearchResultItem,
  type SearchResultsPayload,
} from "./youtubeMusicClient";

export type ArtistResolution = {
  browseId: string;
  title: string | null;
  usedQuery: string;
  score: number;
};

const normalizeString = (value: unknown): string => (typeof value === "string" ? value.trim() : "");
const normalizeLoose = (value: unknown): string => normalizeString(value).toLowerCase().replace(/[^a-z0-9]+/g, "");

const looksLikeBrowseId = (value: string): boolean => {
  const trimmed = value.trim();
  if (!trimmed || trimmed.includes(" ")) return false;
  return /^(OLAK|PL|VL|RD|MP|UU|LL|UC|OL|RV)[A-Za-z0-9_-]+$/i.test(trimmed);
};

function artistBrowseId(artist: SearchResultItem): string {
  return normalizeString(artist.endpointPayload || artist.id);
}

function collectArtistCandidates(results: SearchResultsPayload): SearchResultItem[] {
  const candidates: Array<SearchResultItem | null | undefined> = [];

  if (isArtistResult(results.featured)) {
    candidates.push(results.featured);
  }

  const sectionArtists = Array.isArray(results.sections?.artists) ? results.sections.artists : [];
  candidates.push(...sectionArtists.filter((item) => isArtistResult(item)));

  const orderedArtists = Array.isArray(results.orderedItems)
    ? results.orderedItems.filter((item) => isArtistResult(item))
    : [];
  candidates.push(...orderedArtists);

  const deduped: SearchResultItem[] = [];
  const seen = new Set<string>();

  candidates.forEach((artist) => {
    if (!artist) return;
    const browseId = artistBrowseId(artist);
    if (!looksLikeBrowseId(browseId)) return;
    if (seen.has(browseId)) return;
    seen.add(browseId);
    deduped.push(artist);
  });

  return deduped;
}

function pickBestArtistMatch(
  artists: SearchResultItem[],
  query: string,
  featuredBrowseId: string | null
): { artist: SearchResultItem; score: number } | null {
  const qNorm = normalizeLoose(query);
  const scored = artists
    .map((artist) => {
      const browseId = artistBrowseId(artist);
      const baseScore = scoreArtistMatch(artist, query);
      const exactBonus = qNorm && normalizeLoose(artist.title) === qNorm ? 80 : 0;
      const featuredBonus = featuredBrowseId && browseId === featuredBrowseId ? 60 : 0;
      const score = baseScore + exactBonus + featuredBonus;
      return { artist, score };
    })
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score);

  return scored[0] ?? null;
}

function collectArtistHints(results: SearchResultsPayload): string[] {
  const songs = Array.isArray(results.sections?.songs) ? results.sections.songs : [];
  const hints = songs
    .map((song) => normalizeString((song as any).subtitle || (song as any).title || ""))
    .filter(Boolean);

  return Array.from(new Set(hints));
}

export async function resolveArtistBrowseId(query: string): Promise<ArtistResolution | null> {
  const base = normalizeString(query);
  if (!base) return null;

  const variants = Array.from(
    new Set([
      base,
      base.replace(/[\\/]+/g, " "),
      base.replace(/[^a-z0-9]+/gi, " ").trim(),
      base.replace(/[^a-z0-9]+/gi, ""),
    ].filter(Boolean)),
  );

  for (const variant of variants) {
    const search = await musicSearch(variant);
    const artists = collectArtistCandidates(search);
    const featuredBrowseId = isArtistResult(search.featured) ? artistBrowseId(search.featured) : null;

    const direct = pickBestArtistMatch(artists, variant, featuredBrowseId);
    if (direct) {
      return {
        browseId: artistBrowseId(direct.artist),
        title: normalizeString(direct.artist.title) || null,
        usedQuery: variant,
        score: direct.score,
      };
    }

    const hints = collectArtistHints(search);
    for (const hint of hints) {
      const hinted = pickBestArtistMatch(artists, hint, featuredBrowseId);
      if (hinted) {
        return {
          browseId: artistBrowseId(hinted.artist),
          title: normalizeString(hinted.artist.title) || null,
          usedQuery: hint,
          score: hinted.score,
        };
      }
    }
  }

  return null;
}
