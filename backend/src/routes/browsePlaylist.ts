import { Router } from "express";

import { resolveUserId } from "../lib/resolveUserId";
import { trackActivity } from "../lib/trackActivity";
import { browsePlaylist } from "../services/browsePlaylistService";

const router = Router();
const normalize = (value: unknown): string => (typeof value === "string" ? value.trim() : "");
const SERVICE_NAME = "services/browsePlaylistService";

router.get("/", async (req, res) => {
  const browseId = normalize((req.query.browseId as string) || (req.query.playlistId as string) || (req.query.id as string));
  console.log("[route/browsePlaylist] request", { browseId });

  if (!browseId) {
    return res.status(400).json({ error: "playlist_id_required" });
  }

  try {
    const result = await browsePlaylist(browseId);

    if (!result) {
      console.warn("[route/browsePlaylist] not_found", { browseId, service: SERVICE_NAME });
      return res.status(404).json({ error: "playlist_not_found" });
    }

    const trackCount = Array.isArray(result.tracks) ? result.tracks.length : 0;

    console.log("[route/browsePlaylist] response", {
      browseId,
      service: SERVICE_NAME,
      hasTitle: Boolean(result.title),
      hasSubtitle: Boolean(result.subtitle),
      hasThumbnail: Boolean(result.thumbnail),
      trackCount,
    });

    if (trackCount === 0) {
      console.warn("[route/browsePlaylist] BROWSE_PLAYLIST_EMPTY_TRACKS", { browseId, service: SERVICE_NAME });
    }

    const userId = resolveUserId(req);
    if (userId) {
      void trackActivity({
        userId,
        entityType: "playlist",
        entityId: result.id,
        context: { source: "browse_playlist", browseId: result.id },
      });
    }

    res.set("Cache-Control", "no-store");
    return res.json(result);
  } catch (err: any) {
    console.error("[route/browsePlaylist] failed", { browseId, message: err?.message || "unknown", service: SERVICE_NAME });
    return res.status(500).json({ error: "playlist_browse_failed" });
  }
});

export default router;
