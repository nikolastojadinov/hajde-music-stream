import { Router } from "express";

import { resolveUserId } from "../lib/resolveUserId";
import { trackActivity } from "../lib/trackActivity";
import { browseAlbum } from "../services/browseAlbumService";

const router = Router();

const normalize = (value: unknown): string => (typeof value === "string" ? value.trim() : "");

router.get("/", async (req, res) => {
  const browseId = normalize((req.query.browseId as string) || (req.query.albumId as string) || (req.query.id as string));
  if (!browseId) {
    return res.status(400).json({ error: "album_id_required" });
  }

  try {
    const result = await browseAlbum(browseId);
    if (!result) {
      return res.status(404).json({ error: "album_not_found" });
    }

    const userId = resolveUserId(req);
    if (userId) {
      void trackActivity({
        userId,
        entityType: "album",
        entityId: result.id,
        context: { source: "browse_album", browseId: result.id },
      });
    }

    res.set("Cache-Control", "no-store");
    return res.json(result);
  } catch (err: any) {
    console.error("[browse/album] failed", { browseId, message: err?.message || "unknown" });
    return res.status(500).json({ error: "album_browse_failed" });
  }
});

export default router;
