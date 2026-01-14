import { Router } from "express";
import {
  musicSearch,
  searchSuggestions,
  type SearchResultsPayload,
  type SuggestResponse,
} from "../lib/youtubeMusicClient";
import {
  ingestTrackSelection,
  type TrackSelectionInput,
} from "../services/entityIngestion";
import { indexSuggestFromSearch } from "../services/suggestIndexer";

const router = Router();

const MIN_QUERY_LENGTH = 2;
const CACHE_HEADER = "public, max-age=900";

const EMPTY_RESULTS: SearchResultsPayload = {
  q: "",
  source: "youtube_live",
  featured: null,
  orderedItems: [],
  sections: {
    songs: [],
    artists: [],
    albums: [],
    playlists: [],
  },
};

const normalizeString = (value: unknown): string =>
  typeof value === "string" ? value.trim() : "";

const looksLikeBrowseId = (value: string): boolean => {
  const v = value.trim();
  if (!v || v.includes(" ")) return false;
  return /^(OLAK|PL|VL|RD|MP|UU|LL|UC|OL|RV)[A-Za-z0-9_-]+$/i.test(v);
};

const looksLikeVideoId = (value: string): boolean =>
  /^[A-Za-z0-9_-]{11}$/.test(value.trim());

/* =========================
   SUGGEST
========================= */

router.get("/suggest", async (req, res) => {
  const q = normalizeString(req.query.q);

  const safeResponse = (payload: SuggestResponse) => {
    res.set("Cache-Control", CACHE_HEADER);
    return res.json(payload satisfies SuggestResponse);
  };

  if (q.length < MIN_QUERY_LENGTH || looksLikeBrowseId(q)) {
    return safeResponse({
      q,
      source: "youtube_live",
      suggestions: [],
    });
  }

  try {
    const suggestions = await searchSuggestions(q);
    return safeResponse(suggestions);
  } catch (err) {
    console.error("[search/suggest] failed", {
      q,
      error: err instanceof Error ? err.message : String(err),
    });
    return safeResponse({
      q,
      source: "youtube_live",
      suggestions: [],
    });
  }
});

/* =========================
   RESULTS
========================= */

router.get("/results", async (req, res) => {
  const q = normalizeString(req.query.q);
  const qLower = q.toLowerCase();

  const safeResponse = (payload: SearchResultsPayload) => {
    res.set("Cache-Control", CACHE_HEADER);
    return res.json(payload satisfies SearchResultsPayload);
  };

  if (q.length < MIN_QUERY_LENGTH || looksLikeBrowseId(q)) {
    return safeResponse({ ...EMPTY_RESULTS, q });
  }

  try {
    const payload = await musicSearch(q);

    /**
     * ✅ JEDINA BITNA ISPRAVKA
     * featured MORA biti SearchResultItem
     * i MORA imati prioritet artist sa exact match
     */
    const featured =
      payload.orderedItems.find(
        (item) =>
          item.kind === "artist" &&
          item.title?.toLowerCase() === qLower
      ) ||
      payload.orderedItems.find(
        (item) => item.kind === "artist"
      ) ||
      null;

    const response: SearchResultsPayload = {
      ...payload,
      q,
      source: "youtube_live",
      featured,
    };

    void indexSuggestFromSearch(q, response);
    return safeResponse(response);
  } catch (err) {
    console.error("[search/results] failed", {
      q,
      error: err instanceof Error ? err.message : String(err),
    });
    return safeResponse({ ...EMPTY_RESULTS, q });
  }
});

/* =========================
   INGEST
========================= */

router.post("/ingest", async (req, res) => {
  const body = req.body || {};
  const typeRaw =
    typeof body.type === "string" ? body.type.toLowerCase().trim() : "";

  const selection: TrackSelectionInput = {
    type:
      typeRaw === "video"
        ? "video"
        : typeRaw === "episode"
        ? "episode"
        : "song",
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
    console.error("[search/ingest] failed", {
      id: selection.youtubeId,
      message: err instanceof Error ? err.message : String(err),
    });
    return res.status(500).json({ error: "ingest_failed" });
  }
});

export default router;
