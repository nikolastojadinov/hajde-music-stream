import { Request, Response } from "express";
import supabase from "../services/supabaseClient";
import { normalizeQuery } from "../services/suggestCache";

/**
 * POST /api/suggest/click
 *
 * body:
 * {
 *   source: "spotify",
 *   query: "paulo londra",
 *   itemKey: "artist:3vQ0GE3mI0dAaxIMYe5g7z"
 * }
 */
export async function suggestClick(req: Request, res: Response) {
  try {
    const { source = "spotify", query, itemKey } = req.body ?? {};

    if (!query || !itemKey) {
      return res.status(400).json({
        error: "Missing required fields: query, itemKey",
      });
    }

    const normalizedQuery = normalizeQuery(query);
    if (!normalizedQuery) {
      return res.status(400).json({ error: "Invalid query" });
    }

    /**
     * IMPORTANT:
     * - query je CIST (bez spotify:)
     * - source se salje ODVOJENO
     */
    const { error } = await supabase.rpc("increment_suggest_click", {
      p_source: source,
      p_query: normalizedQuery,
      p_item_key: itemKey,
    });

    if (error) {
      console.warn("[suggestClick] RPC failed", error);
      return res.status(500).json({ error: "Failed to record click" });
    }

    return res.json({ ok: true });
  } catch (err) {
    console.error("[suggestClick] Unexpected error", err);
    return res.status(500).json({ error: "Internal server error" });
  }
}
