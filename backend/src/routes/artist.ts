import { Router } from "express";
import supabase from "../services/supabaseClient";
import { ingestArtistFromYouTubeByChannelId } from "../services/ingestArtistFromYouTube";
import { youtubeFetchPlaylistTracks } from "../services/youtubeFetchPlaylistTracks";

const router = Router();

function normalizeString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

type LocalBundle = { artist: any; playlists: any[]; tracks: any[] };

async function loadLocalArtistBundle(youtube_channel_id: string): Promise<LocalBundle | null> {
  if (!supabase) return null;

  const { data: artist, error: artistError } = await supabase
    .from("artists")
    .select("*")
    .eq("youtube_channel_id", youtube_channel_id)
    .maybeSingle();

  if (artistError) return null;
  if (!artist) return null;

  // Linkage pre-check must rely on fields we actually persist today.
  // Primary link: playlists.channel_id == youtube_channel_id (written by youtubeFetchArtistPlaylists)
  // Fallback link: playlists.channel_title == artist.artist (legacy/partial data)
  const artistName = normalizeString((artist as any)?.artist);

  const playlistsArr: any[] = [];
  const [{ data: byChannelId, error: byChannelIdError }, { data: byChannelTitle, error: byChannelTitleError }] =
    await Promise.all([
      supabase.from("playlists").select("*").eq("channel_id", youtube_channel_id),
      artistName ? supabase.from("playlists").select("*").eq("channel_title", artistName) : Promise.resolve({ data: [], error: null }),
    ]);

  if (byChannelIdError || byChannelTitleError) return null;
  for (const row of Array.isArray(byChannelId) ? byChannelId : []) playlistsArr.push(row);
  for (const row of Array.isArray(byChannelTitle) ? byChannelTitle : []) playlistsArr.push(row);

  // De-dupe playlists by internal id
  const playlistById = new Map<string, any>();
  for (const p of playlistsArr) {
    const id = normalizeString((p as any)?.id);
    if (!id) continue;
    if (!playlistById.has(id)) playlistById.set(id, p);
  }
  const playlistsDeduped = Array.from(playlistById.values());

  // Minimum hydration requirement: we need at least one artist-owned playlist.
  if (playlistsDeduped.length === 0) {
    return null;
  }

  const playlistIds = playlistsDeduped.map((p: any) => normalizeString(p?.id)).filter(Boolean);
  if (playlistIds.length === 0) {
    return null;
  }

  const { data: playlistTracks, error: playlistTracksError } = await supabase
    .from("playlist_tracks")
    .select("playlist_id, track_id, position")
    .in("playlist_id", playlistIds);

  if (playlistTracksError) return null;

  // Preserve a stable ordering: (playlist_id asc, position asc) then first-seen track_id.
  const pts = (Array.isArray(playlistTracks) ? playlistTracks : []).slice();
  pts.sort((a: any, b: any) => {
    const pa = normalizeString(a?.playlist_id);
    const pb = normalizeString(b?.playlist_id);
    if (pa !== pb) return pa.localeCompare(pb);
    const posa = typeof a?.position === 'number' ? a.position : 0;
    const posb = typeof b?.position === 'number' ? b.position : 0;
    return posa - posb;
  });

  const trackIdsOrdered: string[] = [];
  const seenTrackIds = new Set<string>();
  for (const pt of pts) {
    const tid = normalizeString(pt?.track_id);
    if (!tid || seenTrackIds.has(tid)) continue;
    seenTrackIds.add(tid);
    trackIdsOrdered.push(tid);
  }

  if (trackIdsOrdered.length === 0) {
    return null;
  }

  const { data: tracks, error: tracksError } = await supabase.from("tracks").select("*").in("id", trackIdsOrdered);
  if (tracksError) return null;

  const trackById = new Map<string, any>();
  for (const t of Array.isArray(tracks) ? tracks : []) {
    const id = normalizeString((t as any)?.id);
    if (id) trackById.set(id, t);
  }

  const orderedTracks: any[] = [];
  for (const id of trackIdsOrdered) {
    const row = trackById.get(id);
    if (row) orderedTracks.push(row);
  }

  return {
    artist,
    playlists: playlistsDeduped,
    tracks: orderedTracks,
  };
}

function mapBundleForFrontend(youtube_channel_id: string, bundle: LocalBundle): any {
  const a = bundle.artist || null;
  const playlists = Array.isArray(bundle.playlists) ? bundle.playlists : [];
  const tracks = Array.isArray(bundle.tracks) ? bundle.tracks : [];

  const artist = a
    ? {
        id: String((a as any)?.id ?? ''),
        name: normalizeString((a as any)?.artist) || normalizeString((a as any)?.name) || youtube_channel_id,
        youtube_channel_id: normalizeString((a as any)?.youtube_channel_id) || youtube_channel_id,
        spotify_artist_id: (a as any)?.spotify_artist_id ?? null,
        avatar_url: (a as any)?.thumbnail_url ?? (a as any)?.avatar_url ?? null,
      }
    : null;

  const mappedPlaylists = playlists.map((p: any) => ({
    id: String(p?.id ?? ''),
    title: normalizeString(p?.title) || 'Untitled',
    youtube_playlist_id: normalizeString(p?.external_id),
    youtube_channel_id: normalizeString(p?.channel_id) || youtube_channel_id,
    source: normalizeString(p?.source) || 'youtube',
    created_at: (p as any)?.created_at ?? (p as any)?.fetched_on ?? null,
  }));

  const mappedTracks = tracks.map((t: any) => ({
    id: String(t?.id ?? ''),
    title: normalizeString(t?.title) || 'Untitled',
    youtube_video_id: normalizeString(t?.external_id) || normalizeString(t?.youtube_id),
    youtube_channel_id: normalizeString(t?.artist_channel_id) || youtube_channel_id,
    artist_name: normalizeString(t?.artist) || artist?.name || null,
    created_at: (t as any)?.created_at ?? (t as any)?.last_synced_at ?? null,
  }));

  return { artist, playlists: mappedPlaylists, tracks: mappedTracks };
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

    const revalidate = String((req.query as any)?.revalidate ?? '0') === '1';

    let localBefore = await loadLocalArtistBundle(youtube_channel_id);

    // Optional revalidation on repeat clicks: for each known playlist, try a conditional refresh using last_etag.
    if (localBefore && revalidate) {
      const playlists = Array.isArray(localBefore.playlists) ? localBefore.playlists : [];
      for (const p of playlists) {
        const playlist_id = normalizeString((p as any)?.id);
        const external_playlist_id = normalizeString((p as any)?.external_id);
        const last_etag = normalizeString((p as any)?.last_etag) || null;
        if (!playlist_id || !external_playlist_id) continue;
        await youtubeFetchPlaylistTracks({
          playlist_id,
          external_playlist_id,
          if_none_match: last_etag,
        });
      }

      // Reload after potential refresh.
      localBefore = await loadLocalArtistBundle(youtube_channel_id);
    }

    if (localBefore) {
      console.info("[artistRoute] local bundle returned", { youtube_channel_id, revalidate });
      return res.json(mapBundleForFrontend(youtube_channel_id, localBefore));
    }

    console.info("[artistRoute] ingest triggered", { youtube_channel_id });

    const ingest = await ingestArtistFromYouTubeByChannelId({ youtube_channel_id });
    if (!ingest) {
      console.info("[artistRoute] ingest failed", { youtube_channel_id });
      return res.status(404).json({ error: "Artist not found" });
    }

    const localAfter = await loadLocalArtistBundle(youtube_channel_id);
    if (!localAfter) {
      return res.status(404).json({ error: "Artist not found" });
    }

    return res.json(mapBundleForFrontend(youtube_channel_id, localAfter));
  } catch (err) {
    console.error("[artistRoute] unexpected error", err);
    return res.status(500).json({ error: "Internal error" });
  }
});

export default router;
