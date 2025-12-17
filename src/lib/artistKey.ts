export function deriveArtistKey(input: string): string {
  const raw = typeof input === "string" ? input : "";

  const cleaned = raw
    .trim()
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  return cleaned.replace(/\s/g, "-");
}
