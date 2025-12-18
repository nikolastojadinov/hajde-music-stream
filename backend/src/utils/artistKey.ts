export function normalizeArtistKey(input: string): string {
  return (input ?? "")
    .trim()
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
