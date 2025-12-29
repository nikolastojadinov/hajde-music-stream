import { Request, Response } from "express";
import supabase from "../../services/supabaseClient";
import { youtubeFetchPlaylistTracks } from "../../services/youtubeFetchPlaylistTracks";

const LOG_PREFIX = "[PlaylistRefresh]";
// Short in-process cooldown to collapse duplicate clicks while a refresh is completing.
const LOCAL_COOLDOWN_MS = 30_000;
// Cross-request throttle so multiple users don't hammer the same playlist and burn quota.
const PLAYLIST_THROTTLE_MS = 45 * 60 * 1000;

type RefreshEntry = {
  promise: Promise<number | null> | null;
  startedAt: number | null;
  lastCompletedAt: number | null;
  lastFailedAt: number | null;
};

const refreshMap = new Map<string, RefreshEntry>();

function normalizeString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function getEntry(key: string): RefreshEntry {
  const existing = refreshMap.get(key);
  if (existing) return existing;
  const fresh: RefreshEntry = { promise: null, startedAt: null, lastCompletedAt: null, lastFailedAt: null };
  refreshMap.set(key, fresh);
  return fresh;
}

async function getPlaylistTrackCount(playlistId: string): Promise<number | null> {
  if (!supabase) return null;

  const { count, error } = await supabase
    .from("playlist_tracks")
    .select("track_id", { count: "exact", head: true })
    .eq("playlist_id", playlistId);

  if (error) return null;
  return typeof count === "number" ? count : 0;
}

export async function refreshPlaylistTracks(req: Request, res: Response) {
  const playlistId = normalizeString(req.params.id);
  if (!playlistId) return res.status(400).json({ error: "playlist_id_required" });

  if (!supabase) return res.status(500).json({ error: "supabase_not_initialized" });

  const startedAt = Date.now();

  try {
    const { data: playlist, error: playlistError } = await supabase
      .from("playlists")
      .select("id, external_id, last_etag, last_refreshed_on")
      .eq("id", playlistId)
      .maybeSingle();

    if (playlistError) {
      return res.status(500).json({ error: "playlist_lookup_failed" });
    }

    const externalId = normalizeString((playlist as any)?.external_id);
    const lastEtag = normalizeString((playlist as any)?.last_etag);
    const lastRefreshedOnRaw = (playlist as any)?.last_refreshed_on;
    const lastRefreshedOnMs = lastRefreshedOnRaw ? Date.parse(lastRefreshedOnRaw) : null;

    if (!externalId) {
      return res.status(404).json({ error: "playlist_external_id_missing" });
    }

    const trackCount = await getPlaylistTrackCount(playlistId);
    const hasAnyTracks = typeof trackCount === "number" ? trackCount > 0 : false;

    console.info(LOG_PREFIX, "START", {
      playlist_id: playlistId,
      external_playlist_id: externalId,
      hasAnyTracks,
      trackCount: typeof trackCount === "number" ? trackCount : null,
      hasLastEtag: Boolean(lastEtag),
      lastRefreshedOn: lastRefreshedOnRaw ?? null,
    });

    const key = playlistId;
    const entry = getEntry(key);

    if (entry.promise) {
      console.info(LOG_PREFIX, "INFLIGHT", {
        playlist_id: playlistId,
        ageMs: entry.startedAt ? Date.now() - entry.startedAt : null,
      });
      await entry.promise;
      return res.json({ ok: true, playlist_id: playlistId, status: "inflight" });
    }

    if (lastRefreshedOnMs && Number.isFinite(lastRefreshedOnMs)) {
      const throttleAgeMs = Date.now() - lastRefreshedOnMs;
      if (throttleAgeMs < PLAYLIST_THROTTLE_MS) {
        console.info(LOG_PREFIX, "THROTTLED", {
          playlist_id: playlistId,
          ageMs: throttleAgeMs,
          throttleMs: PLAYLIST_THROTTLE_MS,
        });
        return res.json({ ok: true, playlist_id: playlistId, status: "throttled", ageMs: throttleAgeMs, throttleMs: PLAYLIST_THROTTLE_MS });
      }
    }

    const last = entry.lastCompletedAt ?? entry.lastFailedAt ?? 0;
    const ageMs = last > 0 ? Date.now() - last : null;

    if (LOCAL_COOLDOWN_MS > 0 && ageMs !== null && ageMs < LOCAL_COOLDOWN_MS) {
      console.info(LOG_PREFIX, "COOLDOWN", { playlist_id: playlistId, ageMs, ttlMs: LOCAL_COOLDOWN_MS });
      return res.json({ ok: true, playlist_id: playlistId, status: "cooldown", ageMs, ttlMs: LOCAL_COOLDOWN_MS });
    }

    entry.startedAt = Date.now();
    entry.promise = youtubeFetchPlaylistTracks({
      playlist_id: playlistId,
      external_playlist_id: externalId,
      // If we already have tracks, allow a cheap 304 path.
      // If we have 0 tracks, force a fetch so we can populate from scratch.
      if_none_match: hasAnyTracks && lastEtag ? lastEtag : null,
      // Once there is at least one track, avoid destructive replace to save quota.
      replace_existing: !hasAnyTracks,
    });

    refreshMap.set(key, entry);

    const insertedTracks = await entry.promise;
    if (insertedTracks === null) {
      entry.lastFailedAt = Date.now();
      console.warn(LOG_PREFIX, "FAILED", {
        playlist_id: playlistId,
        external_playlist_id: externalId,
        durationMs: Date.now() - startedAt,
      });
      return res.status(500).json({ error: "playlist_refresh_failed" });
    }

    entry.lastCompletedAt = Date.now();

    const afterCount = await getPlaylistTrackCount(playlistId);
    console.info(LOG_PREFIX, "DONE", {
      playlist_id: playlistId,
      external_playlist_id: externalId,
      inserted_tracks: insertedTracks,
      trackCountBefore: typeof trackCount === "number" ? trackCount : null,
      trackCountAfter: typeof afterCount === "number" ? afterCount : null,
      durationMs: Date.now() - startedAt,
    });

    return res.json({ ok: true, playlist_id: playlistId, status: "refreshed", inserted_tracks: insertedTracks });
  } catch (error) {
    console.warn(LOG_PREFIX, "ERROR", {
      playlist_id: playlistId,
      durationMs: Date.now() - startedAt,
    });
    return res.status(500).json({ error: "playlist_refresh_failed" });
  } finally {
    const key = playlistId;
    const entry = refreshMap.get(key);
    if (entry) {
      entry.promise = null;
      entry.startedAt = null;
      refreshMap.set(key, entry);
    }
  }
}
