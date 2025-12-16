import { Router } from "express";

import supabase from "../services/supabaseClient";
import { youtubeSearchArtistChannel } from "../services/youtubeClient";
import { youtubeFetchPlaylistTracks } from "../services/youtubeFetchPlaylistTracks";
import {
  deleteYoutubeChannelMappingByChannelId,
  findYoutubeChannelMappingByArtistName,
  upsertYoutubeChannelMapping,
  validateYouTubeChannelId,
} from "../services/artistResolver";
import { ingestArtistFromYouTubeByChannelId } from "../services/ingestArtistFromYouTube";

const router = Router();

function normalizeString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function isLikelyYouTubeChannelId(value: string): boolean {
  // Most YouTube channel IDs are 24 chars and start with UC.
  return /^UC[\w-]{22}$/.test(value);
}

type LocalBundle = { artist: any; playlists: any[]; tracks: any[] };

type ArtistDebug = {
  input_artist_identifier: string;
  stored_channel_id: string | null;
  channel_validation_result: "valid" | "invalid" | "none";
  search_fallback_used: boolean;
  hydration_started: boolean;
  playlists_fetched_count: number;
  tracks_fetched_count: number;
};

function makeDebug(input: {
  input_artist_identifier: string;
  stored_channel_id: string | null;
  channel_validation_result: "valid" | "invalid" | "none";
  search_fallback_used: boolean;
  hydration_started: boolean;
  playlists_fetched_count: number;
  tracks_fetched_count: number;
}): ArtistDebug {
  return {
    input_artist_identifier: input.input_artist_identifier,
    stored_channel_id: input.stored_channel_id,
    channel_validation_result: input.channel_validation_result,
    search_fallback_used: input.search_fallback_used,
    hydration_started: input.hydration_started,
    playlists_fetched_count: input.playlists_fetched_count,
    tracks_fetched_count: input.tracks_fetched_count,
  };
}

async function loadLocalArtistBundle(youtube_channel_id: string): Promise<LocalBundle | null> {
  if (!supabase) return null;

  const { data: artist, error: artistError } = await supabase
    .from("artists")
    .select("*")
    .eq("youtube_channel_id", youtube_channel_id)
    .maybeSingle();

  if (artistError) return null;
  if (!artist) return null;

  const artistName = normalizeString((artist as any)?.artist);

  const playlistsArr: any[] = [];
  const [{ data: byChannelId, error: byChannelIdError }, { data: byChannelTitle, error: byChannelTitleError }] = await Promise.all([
    supabase.from("playlists").select("*").eq("channel_id", youtube_channel_id),
    artistName
      ? supabase.from("playlists").select("*").eq("channel_title", artistName)
      : Promise.resolve({ data: [], error: null }),
  ]);

  if (byChannelIdError || byChannelTitleError) return null;
  for (const row of Array.isArray(byChannelId) ? byChannelId : []) playlistsArr.push(row);
  for (const row of Array.isArray(byChannelTitle) ? byChannelTitle : []) playlistsArr.push(row);

  const playlistById = new Map<string, any>();
  for (const p of playlistsArr) {
    const id = normalizeString((p as any)?.id);
    if (!id) continue;
    if (!playlistById.has(id)) playlistById.set(id, p);
  }
  const playlistsDeduped = Array.from(playlistById.values());

  if (playlistsDeduped.length === 0) return null;

  const playlistIds = playlistsDeduped.map((p: any) => normalizeString(p?.id)).filter(Boolean);
  if (playlistIds.length === 0) return null;

  const { data: playlistTracks, error: playlistTracksError } = await supabase
    .from("playlist_tracks")
    .select("playlist_id, track_id, position")
    .in("playlist_id", playlistIds);

  if (playlistTracksError) return null;

  const pts = (Array.isArray(playlistTracks) ? playlistTracks : []).slice();
  pts.sort((a: any, b: any) => {
    const pa = normalizeString(a?.playlist_id);
    const pb = normalizeString(b?.playlist_id);
    if (pa !== pb) return pa.localeCompare(pb);
    const posa = typeof a?.position === "number" ? a.position : 0;
    const posb = typeof b?.position === "number" ? b.position : 0;
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

  if (trackIdsOrdered.length === 0) return null;

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

  return { artist, playlists: playlistsDeduped, tracks: orderedTracks };
}

function mapBundleForFrontend(youtube_channel_id: string, bundle: LocalBundle): any {
  const a = bundle.artist || null;
  const playlists = Array.isArray(bundle.playlists) ? bundle.playlists : [];
  const tracks = Array.isArray(bundle.tracks) ? bundle.tracks : [];

  const artist = a
    ? {
        id: String((a as any)?.id ?? ""),
        name: normalizeString((a as any)?.artist) || normalizeString((a as any)?.name) || youtube_channel_id,
        youtube_channel_id: normalizeString((a as any)?.youtube_channel_id) || youtube_channel_id,
        spotify_artist_id: (a as any)?.spotify_artist_id ?? null,
        avatar_url: (a as any)?.thumbnail_url ?? (a as any)?.avatar_url ?? null,
      }
    : null;

  const mappedPlaylists = playlists.map((p: any) => ({
    id: String(p?.id ?? ""),
    title: normalizeString(p?.title) || "Untitled",
    youtube_playlist_id: normalizeString(p?.external_id),
    youtube_channel_id: normalizeString(p?.channel_id) || youtube_channel_id,
    source: normalizeString(p?.source) || "youtube",
    created_at: (p as any)?.created_at ?? (p as any)?.fetched_on ?? null,
  }));

  const mappedTracks = tracks.map((t: any) => ({
    id: String(t?.id ?? ""),
    title: normalizeString(t?.title) || "Untitled",
    youtube_video_id: normalizeString(t?.external_id) || normalizeString(t?.youtube_id),
    youtube_channel_id: normalizeString(t?.artist_channel_id) || youtube_channel_id,
    artist_name: normalizeString(t?.artist) || artist?.name || null,
    created_at: (t as any)?.created_at ?? (t as any)?.last_synced_at ?? null,
  }));

  return { artist, playlists: mappedPlaylists, tracks: mappedTracks };
}

function mapOkForFrontend(youtube_channel_id: string, bundle: LocalBundle, debug: ArtistDebug): any {
  return { status: "ok", ...mapBundleForFrontend(youtube_channel_id, bundle), debug };
}

async function loadAndMaybeRevalidateLocalBundle(youtube_channel_id: string, revalidate: boolean): Promise<LocalBundle | null> {
  let local = await loadLocalArtistBundle(youtube_channel_id);
  if (!local) return null;

  if (!revalidate) return local;

  const playlists = Array.isArray(local.playlists) ? local.playlists : [];
  for (const p of playlists) {
    const playlist_id = normalizeString((p as any)?.id);
    const external_playlist_id = normalizeString((p as any)?.external_id);
    const last_etag = normalizeString((p as any)?.last_etag) || null;
    if (!playlist_id || !external_playlist_id) continue;
    await youtubeFetchPlaylistTracks({ playlist_id, external_playlist_id, if_none_match: last_etag });
  }

  return await loadLocalArtistBundle(youtube_channel_id);
}

/**
 * GET /api/artist/:id
 *
 * Deterministic flow (strict order):
 * 1) Always validate the channelId before use.
 * 2) If invalid: delete stored mapping and return { status: "invalid_channel", requiresChannelSelection: true }.
 * 3) If no valid channelId exists (id is an artist name/slug): do YouTube search.list (quota=100) and return candidates.
 * 4) If valid: return local data immediately; otherwise ingest then return local bundle.
 */
router.get("/:id", async (req, res) => {
  const raw = normalizeString(req.params.id);

  let stored_channel_id: string | null = null;
  let channel_validation_result: "valid" | "invalid" | "none" = "none";
  let search_fallback_used = false;
  let hydration_started = false;
  let playlists_fetched_count = 0;
  let tracks_fetched_count = 0;

  const finalizeDebug = () =>
    makeDebug({
      input_artist_identifier: raw,
      stored_channel_id,
      channel_validation_result,
      search_fallback_used,
      hydration_started,
      playlists_fetched_count,
      tracks_fetched_count,
    });

  try {
    if (!supabase) return res.status(500).json({ error: "Supabase not configured", debug: finalizeDebug() });
    if (!raw) return res.status(400).json({ error: "Missing id", debug: finalizeDebug() });

    const revalidate = String((req.query as any)?.revalidate ?? "0") === "1";

    // Path A: caller provided a concrete channelId.
    if (isLikelyYouTubeChannelId(raw)) {
      const youtube_channel_id = raw;
      stored_channel_id = youtube_channel_id;

      const validation = await validateYouTubeChannelId(youtube_channel_id);
      if (validation.status === "invalid") {
        channel_validation_result = "invalid";
        await deleteYoutubeChannelMappingByChannelId(youtube_channel_id);
        return res.status(200).json({ status: "invalid_channel", requiresChannelSelection: true, debug: finalizeDebug() });
      }
      if (validation.status === "error") {
        channel_validation_result = "none";
        return res.status(502).json({ error: "YouTube validation failed", debug: finalizeDebug() });
      }
      channel_validation_result = "valid";

      const localBefore = await loadAndMaybeRevalidateLocalBundle(youtube_channel_id, revalidate);
      if (localBefore) {
        playlists_fetched_count = Array.isArray(localBefore.playlists) ? localBefore.playlists.length : 0;
        tracks_fetched_count = Array.isArray(localBefore.tracks) ? localBefore.tracks.length : 0;
        return res.status(200).json(mapOkForFrontend(youtube_channel_id, localBefore, finalizeDebug()));
      }

      hydration_started = true;
      const ingest = await ingestArtistFromYouTubeByChannelId({
        youtube_channel_id,
        artistName: validation.channelTitle ?? youtube_channel_id,
      });

      if (!ingest) {
        return res.status(404).json({ error: "Artist not found", debug: finalizeDebug() });
      }

      const localAfter = await loadLocalArtistBundle(youtube_channel_id);
      if (!localAfter) {
        return res.status(404).json({ error: "Artist not found", debug: finalizeDebug() });
      }

      playlists_fetched_count = Array.isArray(localAfter.playlists) ? localAfter.playlists.length : 0;
      tracks_fetched_count = Array.isArray(localAfter.tracks) ? localAfter.tracks.length : 0;
      return res.status(200).json(mapOkForFrontend(youtube_channel_id, localAfter, finalizeDebug()));
    }

    // Path B: caller provided an artist name/slug (no channelId).
    const artistName = raw;

    // First: attempt stored mapping by name, but still validate before use.
    const stored = await findYoutubeChannelMappingByArtistName(artistName);
    if (stored?.youtube_channel_id) {
      const mappedId = normalizeString(stored.youtube_channel_id);
      stored_channel_id = mappedId || null;

      const validation = await validateYouTubeChannelId(mappedId);
      if (validation.status === "invalid") {
        channel_validation_result = "invalid";
        await deleteYoutubeChannelMappingByChannelId(mappedId);
        return res.status(200).json({ status: "invalid_channel", requiresChannelSelection: true, debug: finalizeDebug() });
      }

      if (validation.status === "valid") {
        channel_validation_result = "valid";

        // Best-effort: keep mapping fresh.
        await upsertYoutubeChannelMapping({
          name: validation.channelTitle ?? stored.name ?? artistName,
          youtube_channel_id: mappedId,
          thumbnail_url: validation.thumbnailUrl ?? stored.thumbnail_url ?? null,
        });

        const localBefore = await loadAndMaybeRevalidateLocalBundle(mappedId, revalidate);
        if (localBefore) {
          playlists_fetched_count = Array.isArray(localBefore.playlists) ? localBefore.playlists.length : 0;
          tracks_fetched_count = Array.isArray(localBefore.tracks) ? localBefore.tracks.length : 0;
          return res.status(200).json(mapOkForFrontend(mappedId, localBefore, finalizeDebug()));
        }

        hydration_started = true;
        const ingest = await ingestArtistFromYouTubeByChannelId({ youtube_channel_id: mappedId, artistName: artistName });
        if (!ingest) return res.status(404).json({ error: "Artist not found", debug: finalizeDebug() });

        const localAfter = await loadLocalArtistBundle(mappedId);
        if (!localAfter) return res.status(404).json({ error: "Artist not found", debug: finalizeDebug() });

        playlists_fetched_count = Array.isArray(localAfter.playlists) ? localAfter.playlists.length : 0;
        tracks_fetched_count = Array.isArray(localAfter.tracks) ? localAfter.tracks.length : 0;
        return res.status(200).json(mapOkForFrontend(mappedId, localAfter, finalizeDebug()));
      }

      channel_validation_result = "none";
      return res.status(502).json({ error: "YouTube validation failed", debug: finalizeDebug() });
    }

    // Only here (no valid channelId exists): YouTube search.list (quota=100).
    search_fallback_used = true;
    const candidates = await youtubeSearchArtistChannel(artistName);
    return res.status(200).json({ status: "requires_channel_selection", candidates, debug: finalizeDebug() });
  } catch (err) {
    console.error("[artistRoute] unexpected error", err);
    return res.status(500).json({ error: "Internal error", debug: finalizeDebug() });
  }
});

/**
 * POST /api/artist/selected
 *
 * Frontend sends a selected channelId for an artist name.
 * Strict order:
 * 1) Validate via channels.list
 * 2) Persist youtube_channel_id mapping
 * 3) Hydrate playlists/tracks (valid channel only)
 */
router.post("/selected", async (req, res) => {
  const artistName = normalizeString((req.body as any)?.artistName);
  const youtube_channel_id = normalizeString((req.body as any)?.youtube_channel_id);

  let stored_channel_id: string | null = youtube_channel_id || null;
  let channel_validation_result: "valid" | "invalid" | "none" = "none";
  let search_fallback_used = false;
  let hydration_started = false;
  let playlists_fetched_count = 0;
  let tracks_fetched_count = 0;

  const finalizeDebug = () =>
    makeDebug({
      input_artist_identifier: artistName,
      stored_channel_id,
      channel_validation_result,
      search_fallback_used,
      hydration_started,
      playlists_fetched_count,
      tracks_fetched_count,
    });

  try {
    if (!supabase) return res.status(500).json({ error: "Supabase not configured", debug: finalizeDebug() });

    if (!artistName) return res.status(400).json({ error: "Missing artistName", debug: finalizeDebug() });
    if (!youtube_channel_id) return res.status(400).json({ error: "Missing youtube_channel_id", debug: finalizeDebug() });

    const validation = await validateYouTubeChannelId(youtube_channel_id);
    if (validation.status === "invalid") {
      channel_validation_result = "invalid";
      await deleteYoutubeChannelMappingByChannelId(youtube_channel_id);
      return res.status(200).json({ status: "invalid_channel", requiresChannelSelection: true, debug: finalizeDebug() });
    }
    if (validation.status === "error") {
      channel_validation_result = "none";
      return res.status(502).json({ error: "YouTube validation failed", debug: finalizeDebug() });
    }
    channel_validation_result = "valid";

    await upsertYoutubeChannelMapping({
      name: validation.channelTitle ?? artistName,
      youtube_channel_id,
      thumbnail_url: validation.thumbnailUrl ?? null,
    });

    hydration_started = true;
    const ingest = await ingestArtistFromYouTubeByChannelId({ youtube_channel_id, artistName });
    if (!ingest) {
      return res.status(404).json({ error: "Artist not found", debug: finalizeDebug() });
    }

    const local = await loadLocalArtistBundle(youtube_channel_id);
    if (!local) return res.status(404).json({ error: "Artist not found", debug: finalizeDebug() });

    playlists_fetched_count = Array.isArray(local.playlists) ? local.playlists.length : 0;
    tracks_fetched_count = Array.isArray(local.tracks) ? local.tracks.length : 0;
    return res.status(200).json(mapOkForFrontend(youtube_channel_id, local, finalizeDebug()));
  } catch (err) {
    console.error("[artistRoute] unexpected error", err);
    return res.status(500).json({ error: "Internal error", debug: finalizeDebug() });
  }
});

export default router;
