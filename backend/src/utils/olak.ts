function normalizeString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

export function isOlakPlaylistId(externalPlaylistId: unknown): boolean {
  const id = normalizeString(externalPlaylistId);
  if (!id) return false;
  // YouTube Music auto-generated album playlists typically start with "OLAK" (often "OLAK5uy").
  return id.startsWith("OLAK");
}
