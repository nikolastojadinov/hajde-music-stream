/**
 * Remove the YouTube Topic suffix from an artist/channel title.
 * Example: "Hoang Lan - Topic" -> "Hoang Lan".
 */
export function stripTopicSuffix(input: string): string {
  return (input ?? "").trim().replace(/\s*-\s*topic$/i, "").trim();
}

/**
 * Canonical display name for artists (no trailing "- Topic", trimmed).
 */
export function canonicalArtistName(input: string): string {
  return stripTopicSuffix(input ?? "").trim();
}

export function normalizeArtistKey(input: string): string {
  const canonical = canonicalArtistName(input);
  return canonical
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-+/g, "-");
}

export function artistKeyToQuery(artistKey: string): string {
  return (artistKey ?? "").replace(/-/g, " ").trim();
}
