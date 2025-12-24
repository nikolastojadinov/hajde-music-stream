const DASH_PATTERN = /\s+-\s+/;
const BY_PATTERN = /\s+by\s+/i;

export type NormalizedSearch = {
  normalizedQuery: string;
  probableArtist: string | null;
  probableTrack: string | null;
};

function collapseWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function cleanPart(part: string | null | undefined): string {
  return collapseWhitespace(typeof part === "string" ? part : "");
}

function parseDashPattern(q: string): { artist: string | null; track: string | null } | null {
  const parts = q.split(DASH_PATTERN);
  if (parts.length !== 2) return null;
  const [left, right] = parts.map(cleanPart);
  if (!left || !right) return null;
  // Common convention: "Track - Artist"
  return { track: left, artist: right };
}

function parseByPattern(q: string): { artist: string | null; track: string | null } | null {
  const parts = q.split(BY_PATTERN);
  if (parts.length !== 2) return null;
  const [left, right] = parts.map(cleanPart);
  if (!left || !right) return null;
  // "Track by Artist"
  return { track: left, artist: right };
}

function parseArtistTrackPattern(q: string): { artist: string | null; track: string | null } | null {
  // Heuristic: two segments, artist first, then track
  const tokens = q.split(" ").map(cleanPart).filter(Boolean);
  if (tokens.length < 2) return null;
  const artist = tokens[0];
  const track = collapseWhitespace(tokens.slice(1).join(" "));
  if (!artist || !track) return null;
  return { artist, track };
}

export function normalizeSearchQuery(raw: string | null | undefined): NormalizedSearch {
  const normalizedQuery = collapseWhitespace(typeof raw === "string" ? raw : "");

  let probableArtist: string | null = null;
  let probableTrack: string | null = null;

  if (normalizedQuery) {
    const dash = parseDashPattern(normalizedQuery);
    if (dash) {
      probableArtist = dash.artist;
      probableTrack = dash.track;
    } else {
      const by = parseByPattern(normalizedQuery);
      if (by) {
        probableArtist = by.artist;
        probableTrack = by.track;
      } else {
        const artistTrack = parseArtistTrackPattern(normalizedQuery);
        if (artistTrack) {
          probableArtist = artistTrack.artist;
          probableTrack = artistTrack.track;
        }
      }
    }
  }

  return { normalizedQuery, probableArtist, probableTrack };
}

// Exposed for unit tests
export const _internals = {
  collapseWhitespace,
  parseDashPattern,
  parseByPattern,
  parseArtistTrackPattern,
  cleanPart,
};
