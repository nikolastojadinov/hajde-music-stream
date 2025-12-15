import { Router } from "express";
import supabase from "../services/supabaseClient";
import { ingestArtistFromYouTube } from "../services/ingestArtistFromYouTube";

const router = Router();

function normalizeString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

async function loadLocalArtistBundle(youtube_channel_id: string): Promise<{ artist: any; playlists: any[]; tracks: any[] } | null> {
  if (!supabase) return null;

  const { data: artist, error: artistError } = await supabase
    .from("artists")
    .select("*")
    .eq("youtube_channel_id", youtube_channel_id)
    .maybeSingle();

  if (artistError) return null;
  if (!artist) return null;

  const { data: playlists, error: playlistsError } = await supabase
    .from("playlists")
    .select("*")
    .eq("channel_id", youtube_channel_id);

  if (playlistsError) return null;
  const playlistsArr = Array.isArray(playlists) ? playlists : [];

  const playlistIds = playlistsArr.map((p: any) => normalizeString(p?.id)).filter(Boolean);
  if (playlistIds.length === 0) {
    return { artist, playlists: playlistsArr, tracks: [] };
  }

  const { data: playlistTracks, error: playlistTracksError } = await supabase
    .from("playlist_tracks")
    .select("playlist_id, track_id, position")
    .in("playlist_id", playlistIds);

  if (playlistTracksError) return null;

  const trackIds = Array.from(
    new Set(
      (Array.isArray(playlistTracks) ? playlistTracks : [])
        .map((pt: any) => normalizeString(pt?.track_id))
        .filter(Boolean)
    )
  );

  if (trackIds.length === 0) {
    return { artist, playlists: playlistsArr, tracks: [] };
  }

  const { data: tracks, error: tracksError } = await supabase.from("tracks").select("*").in("id", trackIds);
  if (tracksError) return null;

  return {
    artist,
    playlists: playlistsArr,
    tracks: Array.isArray(tracks) ? tracks : [],
  };
}

/**
 * GET /api/artist/:channelId
 *
 * Local-first:
 * - If artist exists in `artists` by youtube_channel_id, returns local data only.
 * - If not, triggers a single ingest via ingestArtistFromYouTube (no YouTube calls directly here).
 */
router.get("/:channelId", async (req, res) => {
  try {
    if (!supabase) return res.status(500).json({ error: "Supabase not configured" });

    const youtube_channel_id = normalizeString(req.params.channelId);
    if (!youtube_channel_id) return res.status(400).json({ error: "Missing channelId" });

    const localBefore = await loadLocalArtistBundle(youtube_channel_id);
    if (localBefore) {
      console.info("[artistRoute] ingest skipped (already hydrated)", { youtube_channel_id });
      return res.json(localBefore);
    }

    console.info("[artistRoute] ingest triggered", { youtube_channel_id });

    const { data: channelRow, error: channelError } = await supabase
      .from("youtube_channels")
      .select("name")
      .eq("youtube_channel_id", youtube_channel_id)
      .maybeSingle();

    if (channelError) {
      console.error("[artistRoute] youtube_channels lookup failed", channelError);
      return res.status(404).json({ error: "Artist not found" });
    }

    const inferredArtistName = normalizeString((channelRow as any)?.name) || youtube_channel_id;

    const ingest = await ingestArtistFromYouTube({ artistName: inferredArtistName });
    if (!ingest) {
      console.info("[artistRoute] ingest failed", { youtube_channel_id, inferredArtistName });
      return res.status(404).json({ error: "Artist not found" });
    }

    const localAfter = await loadLocalArtistBundle(youtube_channel_id);
    if (!localAfter) {
      return res.status(404).json({ error: "Artist not found" });
    }

    return res.json(localAfter);
  } catch (err) {
    console.error("[artistRoute] unexpected error", err);
    return res.status(500).json({ error: "Internal error" });
  }
});

export default router;
