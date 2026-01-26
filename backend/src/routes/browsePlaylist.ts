import { Router } from "express";

import { resolveUserId } from "../lib/resolveUserId";
import { trackActivity } from "../lib/trackActivity";
import { browsePlaylist } from "../services/browsePlaylistService";

const router = Router();

const normalize = (value: unknown): string => (typeof value === "string" ? value.trim() : "");

router.get("/", async (req, res) => {
  const browseId = normalize((req.query.browseId as string) || (req.query.playlistId as string) || (req.query.id as string));
  if (!browseId) {
    return res.status(400).json({ error: "playlist_id_required" });
  }

  try {
    const result = await browsePlaylist(browseId);
    if (!result) {
      return res.status(404).json({ error: "playlist_not_found" });
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
    console.error("[browse/playlist] failed", { browseId, message: err?.message || "unknown" });
    return res.status(500).json({ error: "playlist_browse_failed" });
  }
});

export default router;
