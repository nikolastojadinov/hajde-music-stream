import { Router } from "express";

import { trackActivity } from "../lib/activityTracker";
import supabase from "../services/supabaseClient";
import { getLastValidSearchSession, saveSearchSession } from "../lib/searchSessionManager";
import {
  musicSearch,
  searchSuggestions,
  type SearchResultsPayload,
  type SuggestResponse,
} from "../lib/youtubeMusicClient";
import { resolveArtistBrowseId } from "../lib/artistResolver";
import { browseArtistById } from "../services/youtubeMusicClient";
import {
  ingestArtistBrowse,
  ingestTrackSelection,
  type TrackSelectionInput,
} from "../services/entityIngestion";
import { resolveUserId } from "../lib/resolveUserId";

const router = Router();

const CACHE_HEADER = "public, max-age=900";
const MIN_QUERY_LENGTH = 2;

const EMPTY_RESULTS: SearchResultsPayload = {
  q: "",
  source: "youtube_live",
  featured: null,
  orderedItems: [],
  sections: { songs: [], artists: [], albums: [], playlists: [] },
} as any;

const normalizeString = (value: unknown): string => (typeof value === "string" ? value.trim() : "");
const normalizeLoose = (value: unknown): string => normalizeString(value).toLowerCase().replace(/[^a-z0-9]+/g, "");

const looksLikeBrowseId = (value: string): boolean => {
  const trimmed = value.trim();
  if (!trimmed || trimmed.includes(" ")) return false;
  return /^(OLAK|PL|VL|RD|MP|UU|LL|UC|OL|RV)[A-Za-z0-9_-]+$/i.test(trimmed);
};

const looksLikeVideoId = (value: string): boolean => /^[A-Za-z0-9_-]{11}$/.test(value.trim());

function isRestoreRequested(req: Request): boolean {
  const queryFlag = typeof req.query.restoreSearch === "string" ? req.query.restoreSearch : undefined;
  const headerFlag = typeof req.headers["restoresearch"] === "string" ? (req.headers["restoresearch"] as string) : undefined;

  const normalizeFlag = (value: string | undefined) => (value || "").trim().toLowerCase();
  const q = normalizeFlag(queryFlag);
  const h = normalizeFlag(headerFlag);

  return q === "true" || q === "1" || h === "true" || h === "1";
}

router.get("/suggest", async (req, res) => {
  const q = normalizeString(req.query.q);

  const safeResponse = (payload: SuggestResponse) => {
    res.set("Cache-Control", CACHE_HEADER);
    return res.json(payload satisfies SuggestResponse);
  };

  if (q.length < MIN_QUERY_LENGTH || looksLikeBrowseId(q)) {
    return safeResponse({ q, source: "youtube_live", suggestions: [] });
  }

  try {
    const suggestions = await searchSuggestions(q);
    return safeResponse(suggestions);
  } catch {
    return safeResponse({ q, source: "youtube_live", suggestions: [] });
  }
});

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

  const userId = resolveUserId(req);
  const restoreRequested = isRestoreRequested(req);

  if (restoreRequested && userId) {
    const session = await getLastValidSearchSession({ userId });
    if (session?.results_snapshot) {
      return safeResponse(session.results_snapshot as SearchResultsPayload);
    }
  }

  try {
    const payload = await musicSearch(q);

    const orderedItems: any[] = Array.isArray((payload as any).orderedItems) ? (payload as any).orderedItems : [];
    const sections =
      payload && typeof payload === "object" && (payload as any).sections && typeof (payload as any).sections === "object"
        ? (payload as any).sections
        : { songs: [], artists: [], albums: [], playlists: [] };

    const featured =
      payload.featured ||
      orderedItems.find((item: any) => item.kind === "artist" && item.title?.toLowerCase() === qLower) ||
      orderedItems.find((item: any) => item.kind === "artist") ||
      null;

    const response: SearchResultsPayload = {
      ...(payload as any),
      sections,
      orderedItems,
      q,
      source: "youtube_live",
      featured,
    } as any;

    if (userId) {
      void trackActivity({
        userId,
        entityType: "search",
        entityId: q,
        context: { source: "search", query: q },
      });
      void saveSearchSession({ userId, query: q, results: response });
    }

    return safeResponse(response);
  } catch {
    return safeResponse({ ...EMPTY_RESULTS, q });
  }
});

router.get("/history", async (req, res) => {
  const userId = resolveUserId(req);
  if (!userId || !supabase) {
    return res.json({ items: [] });
  }

  try {
    const { data, error } = await supabase
      .from("user_activity_history")
      .select("id,entity_type,entity_id,context,created_at")
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(50);

    if (error) {
      console.error("[search/history] query_failed", { userId, message: error.message });
      return res.status(500).json({ items: [] });
    }

    const items = (data || []).map((row: { id: string; entity_type: string; entity_id: string; context: any; created_at: string }) => {
      let parsedContext: any = null;
      if (typeof row.context === "string") {
        try {
          parsedContext = JSON.parse(row.context);
        } catch {
          parsedContext = row.context;
        }
      }

      return {
        id: row.id,
        entityType: row.entity_type,
        entityId: row.entity_id,
        context: parsedContext,
        createdAt: row.created_at,
      };
    });

    return res.json({ items });
  } catch (err: any) {
    console.error("[search/history] unexpected_error", { userId, message: err?.message || String(err) });
    return res.status(500).json({ items: [] });
  }
});

router.post("/ingest", async (req, res) => {
  const body = req.body || {};
  const typeRaw = typeof body.type === "string" ? body.type.toLowerCase().trim() : "";

  if (typeRaw === "artist") {
    const browseIdRaw = normalizeString(body.browseId || body.channelId);
    const displayName = normalizeString(body.displayName || body.artistName || body.name);
    const artistKey = normalizeLoose(body.artist_key || body.artistKey);

    let targetBrowseId = looksLikeBrowseId(browseIdRaw) ? browseIdRaw : "";

    if (!targetBrowseId) {
      const resolutionQuery = displayName || artistKey;
      if (!resolutionQuery) {
        return res.status(400).json({ error: "artist_identifier_required" });
      }
      const resolved = await resolveArtistBrowseId(resolutionQuery);
      targetBrowseId = resolved?.browseId || "";
    }

    if (!targetBrowseId) {
      return res.status(400).json({ error: "artist_browse_not_found" });
    }

    try {
      const browse = await browseArtistById(targetBrowseId);
      if (!browse) {
        return res.status(404).json({ error: "artist_not_found", browseId: targetBrowseId });
      }
      await ingestArtistBrowse(browse, { allowArtistWrite: false });

      return res.json({ status: "ok", kind: "artist", browseId: targetBrowseId });
    } catch {
      return res.status(500).json({ error: "ingest_failed", browseId: targetBrowseId });
    }
  }

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
    await ingestTrackSelection(selection, { allowArtistWrite: false });
    return res.json({ status: "ok", kind: "track" });
  } catch {
    return res.status(500).json({ error: "ingest_failed" });
  }
});

export default router;
