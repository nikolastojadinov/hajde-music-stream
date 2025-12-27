export function deriveArtistKey(input: string): string {
  const raw = typeof input === "string" ? input : "";

  const canonical = raw.trim().replace(/\s*-\s*topic$/i, "").trim();

  const normalized = canonical
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-+/g, "-");

  return normalized;
}
