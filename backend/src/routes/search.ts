import { Router } from "express";
import { musicSearch, searchSuggestions, type SearchResultsPayload, type SuggestResponse } from "../lib/youtubeMusicClient";
import { ingestTrackSelection, type TrackSelectionInput } from "../services/entityIngestion";
import { indexSuggestFromSearch } from "../services/suggestIndexer";

const router = Router();

const MIN_QUERY_CHARS = 2;
const CACHE_HEADER = "public, max-age=3600";

function normalizeString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function looksLikeBrowseId(value: string): boolean {
  const v = value.trim();
  if (!v || v.includes(" ")) return false;
  return /^(OLAK|PL|VL|RD|MP|UU|LL|UC|OL|RV)[A-Za-z0-9_-]+$/i.test(v);
}

function looksLikeVideoId(value: string): boolean {
  const v = value.trim();
  return /^[A-Za-z0-9_-]{11}$/.test(v);
}
router.get("/suggest", async (req, res) => {
  const q = normalizeString(req.query.q);

  if (q.length < MIN_QUERY_CHARS || looksLikeBrowseId(q)) {
    res.set("Cache-Control", CACHE_HEADER);
    return res.json({ q, source: "youtube_live", suggestions: [] } satisfies SuggestResponse);
  }

  try {
    const payload = await searchSuggestions(q);
    res.set("Cache-Control", CACHE_HEADER);
    return res.json(payload satisfies SuggestResponse);
  } catch (err) {
    console.error("[search/suggest] failed", { q, error: err instanceof Error ? err.message : String(err) });
    res.set("Cache-Control", CACHE_HEADER);
    return res.json({ q, source: "youtube_live", suggestions: [] } satisfies SuggestResponse);
  }
});

router.get("/results", async (req, res) => {
  const q = normalizeString(req.query.q);

  if (q.length < MIN_QUERY_CHARS || looksLikeBrowseId(q)) {
    res.set("Cache-Control", CACHE_HEADER);
    return res.json({
      q,
      source: "youtube_live",
      featured: null,
      sections: { songs: [], artists: [], albums: [], playlists: [] },
    } satisfies SearchResultsPayload);
  }

  try {
    const payload = await musicSearch(q);
    void indexSuggestFromSearch(q, payload);
    res.set("Cache-Control", CACHE_HEADER);
    return res.json(payload satisfies SearchResultsPayload);
  } catch (err) {
    console.error("[search/results] failed", { q, error: err instanceof Error ? err.message : String(err) });
    res.set("Cache-Control", CACHE_HEADER);
    return res.json({
      q,
      source: "youtube_live",
      featured: null,
      sections: { songs: [], artists: [], albums: [], playlists: [] },
    } satisfies SearchResultsPayload);
  }
});

router.post("/ingest", async (req, res) => {
  const body = req.body || {};
  const typeRaw = typeof body.type === "string" ? body.type.toLowerCase().trim() : "";
  const selection: TrackSelectionInput = {
    type: typeRaw === "video" ? "video" : typeRaw === "episode" ? "episode" : "song",
    youtubeId: normalizeString(body.id || body.youtubeId || body.videoId),
    title: typeof body.title === "string" ? body.title : undefined,
    subtitle: typeof body.subtitle === "string" ? body.subtitle : undefined,
    imageUrl: typeof body.imageUrl === "string" ? body.imageUrl : undefined,
  };

  if (selection.type === "episode") {
    return res.json({ status: "ignored", reason: "episode" });
  }

  if (!selection.youtubeId || !looksLikeVideoId(selection.youtubeId)) {
    return res.status(400).json({ error: "invalid_video_id" });
  }

  try {
    await ingestTrackSelection(selection);
    return res.json({ status: "ok" });
  } catch (err) {
    console.error("[search/ingest] failed", { id: selection.youtubeId, message: err instanceof Error ? err.message : String(err) });
    return res.status(500).json({ error: "ingest_failed" });
  }
});

export default router;
