import supabase from "./supabaseClient";

export type ArtistSeed = {
  artist: string;
  artist_key: string;
  youtube_channel_id: string;
  cover_url: string | null;
};

function normalizeArtistKey(artistName: string): string {
  const raw = typeof artistName === "string" ? artistName : "";

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

function normalizeQuery(artistName: string): string {
  return typeof artistName === "string" ? artistName.trim() : "";
}

/**
 * Backend-only artist resolver.
 *
 * Behavior:
 * 1) Normalize to artist_key.
 * 2) Try `artists` table by artist_key; if found, return that row.
 * 3) Else search `youtube_channels` by name ILIKE %artistName%; if no usable youtube_channel_id, return null.
 * 4) Never calls YouTube APIs.
 */
export async function resolveArtistSeed(artistName: string): Promise<any | ArtistSeed | null> {
  const q = normalizeQuery(artistName);
  const artist_key = normalizeArtistKey(q);

  if (!supabase) return null;
  if (!q || q.length < 2) return null;
  if (!artist_key) return null;

  const { data: existing, error: existingError } = await supabase
    .from("artists")
    .select("*")
    .eq("artist_key", artist_key)
    .maybeSingle();

  if (existingError) {
    return null;
  }

  if (existing) {
    return existing;
  }

  const { data: channel, error: channelError } = await supabase
    .from("youtube_channels")
    .select("name, youtube_channel_id, thumbnail_url")
    .ilike("name", `%${q}%`)
    .limit(1)
    .maybeSingle();

  if (channelError) {
    return null;
  }

  const name = typeof channel?.name === "string" ? channel.name.trim() : "";
  const youtube_channel_id = typeof channel?.youtube_channel_id === "string" ? channel.youtube_channel_id.trim() : "";
  const thumbnail_url = typeof channel?.thumbnail_url === "string" ? channel.thumbnail_url : null;

  if (!youtube_channel_id) return null;

  return {
    artist: name || q,
    artist_key,
    youtube_channel_id,
    cover_url: thumbnail_url,
  } satisfies ArtistSeed;
}
