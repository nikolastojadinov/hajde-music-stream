import { Request, Response } from "express";

import supabase from "../../services/supabaseClient";

const LOG_PREFIX = "[PlaylistPublic]";

export type PublicTrack = {
  id: string;
  title: string;
  artist: string;
  external_id: string;
  duration: number | null;
  cover_url: string | null;
  playlist_id: string | null;
};

export type PublicPlaylist = {
  id: string;
  title: string;
  description: string | null;
  category: string | null;
  cover_url: string | null;
};

export type PublicPlaylistResponse = PublicPlaylist & { tracks: PublicTrack[]; deleted?: boolean };

function normalizeString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function mapTrack(row: any, playlistId: string): PublicTrack | null {
  const id = normalizeString(row?.id);
  const title = normalizeString(row?.title);
  if (!id || !title) return null;

  return {
    id,
    title,
    artist: normalizeString(row?.artist),
    external_id: normalizeString(row?.external_id),
    duration: typeof row?.duration === "number" && Number.isFinite(row.duration) ? row.duration : null,
    cover_url: row?.cover_url ?? null,
    playlist_id: playlistId,
  };
}

async function loadPlaylistWithTracks(playlistId: string): Promise<{ playlist: PublicPlaylist | null; tracks: PublicTrack[] }> {
  if (!supabase) return { playlist: null, tracks: [] };

  const { data: playlistRow, error: playlistError } = await supabase
    .from("playlists")
    .select("id, title, description, category, cover_url")
    .eq("id", playlistId)
    .maybeSingle();

  if (playlistError) {
    console.warn(LOG_PREFIX, "playlist_lookup_failed", { playlistId, code: playlistError.code, message: playlistError.message });
    return { playlist: null, tracks: [] };
  }

  if (!playlistRow?.id) return { playlist: null, tracks: [] };

  let tracks: PublicTrack[] = [];

  const { data: playlistTracks, error: playlistTracksError } = await supabase
    .from("playlist_tracks")
    .select(
      `
        position,
        tracks (
          id,
          title,
          artist,
          cover_url,
          duration,
          external_id
        )
      `
    )
    .eq("playlist_id", playlistId)
    .order("position", { ascending: true });

  if (playlistTracksError) {
    console.warn(LOG_PREFIX, "playlist_tracks_lookup_failed", {
      playlistId,
      code: playlistTracksError.code,
      message: playlistTracksError.message,
    });
  }

  if (Array.isArray(playlistTracks) && playlistTracks.length > 0) {
    tracks = playlistTracks
      .map((pt: any) => (pt?.tracks ? mapTrack(pt.tracks, playlistId) : null))
      .filter((t): t is PublicTrack => Boolean(t));
  }

  if (tracks.length === 0) {
    const { data: directTracks, error: directTracksError } = await supabase
      .from("tracks")
      .select("id, title, artist, cover_url, duration, external_id")
      .eq("playlist_id", playlistId)
      .order("created_at", { ascending: true });

    if (directTracksError) {
      console.warn(LOG_PREFIX, "direct_tracks_lookup_failed", {
        playlistId,
        code: directTracksError.code,
        message: directTracksError.message,
      });
    }

    if (Array.isArray(directTracks) && directTracks.length > 0) {
      tracks = directTracks.map((t: any) => mapTrack(t, playlistId)).filter((t): t is PublicTrack => Boolean(t));
    }
  }

  const playlist: PublicPlaylist = {
    id: playlistRow.id,
    title: playlistRow.title ?? "",
    description: playlistRow.description ?? null,
    category: playlistRow.category ?? null,
    cover_url: playlistRow.cover_url ?? null,
  };

  return { playlist, tracks };
}

async function deletePlaylistCascade(playlistId: string): Promise<void> {
  if (!supabase) return;

  const cleanupTargets = [
    { table: "playlist_tracks", column: "playlist_id" },
    { table: "playlist_categories", column: "playlist_id" },
    { table: "playlist_views", column: "playlist_id" },
    { table: "playlist_likes", column: "playlist_id" },
  ];

  for (const target of cleanupTargets) {
    const { error } = await supabase.from(target.table).delete().eq(target.column, playlistId);
    if (error) {
      console.warn(LOG_PREFIX, `${target.table}_cleanup_failed`, {
        playlistId,
        code: error.code,
        message: error.message,
      });
    }
  }

  const { error: deleteError } = await supabase.from("playlists").delete().eq("id", playlistId);
  if (deleteError) {
    console.warn(LOG_PREFIX, "playlist_delete_failed", { playlistId, code: deleteError.code, message: deleteError.message });
  } else {
    console.info(LOG_PREFIX, "playlist_deleted", { playlistId });
  }
}

export async function getPublicPlaylist(req: Request, res: Response) {
  const playlistId = normalizeString(req.params.id);
  if (!playlistId) return res.status(400).json({ error: "playlist_id_required" });
  if (!supabase) return res.status(500).json({ error: "supabase_not_initialized" });

  try {
    const { playlist, tracks } = await loadPlaylistWithTracks(playlistId);
    if (!playlist) return res.status(404).json({ error: "playlist_not_found" });

    const response: PublicPlaylistResponse = { ...playlist, tracks };

    if (tracks.length === 0) {
      void deletePlaylistCascade(playlistId).catch((err: any) => {
        console.warn(LOG_PREFIX, "playlist_delete_error", {
          playlistId,
          message: err?.message ? String(err.message) : "unknown",
        });
      });
      response.deleted = true;
    }

    return res.json(response);
  } catch (err: any) {
    console.warn(LOG_PREFIX, "unexpected_error", {
      playlistId,
      message: err?.message ? String(err.message) : "unknown",
    });
    return res.status(500).json({ error: "playlist_fetch_failed" });
  }
}
