import type { Request, Response } from "express";
import express from "express";
import fetch from "node-fetch";
import { createClient } from "@supabase/supabase-js";

const router = express.Router();

const SUPABASE_URL = process.env.SUPABASE_URL!;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const YT_API_KEY = process.env.YOUTUBE_API_KEY || process.env.VITE_YOUTUBE_API_KEY; // fallback

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

// basic slug -> "queen", "bajaga-i-instruktori"
const normalizeKey = (s: string) =>
  s
    .toLowerCase()
    .trim()
    .replace(/['"]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");

async function fetchJson(url: string) {
  const res = await fetch(url);
  const txt = await res.text();
  let json: any = null;
  try {
    json = JSON.parse(txt);
  } catch {
    // ignore
  }
  if (!res.ok) {
    const msg = json?.error?.message || txt || `HTTP ${res.status}`;
    throw new Error(msg);
  }
  return json;
}

router.get("/artist/:artistKey", async (req: Request, res: Response) => {
  try {
    const artistKeyRaw = String(req.params.artistKey || "");
    const artistKey = normalizeKey(artistKeyRaw);

    if (!artistKey) {
      return res.status(400).json({ error: "Missing artistKey" });
    }

    // 1) check DB
    const { data: existing, error: dbErr } = await supabase
      .from("artists")
      .select(
        "id, artist, artist_key, youtube_channel_id, description, thumbnail_url, banner_url, subscribers, views, country, source"
      )
      .eq("artist_key", artistKey)
      .maybeSingle();

    if (dbErr) {
      console.error("[artist] db error:", dbErr);
      return res.status(500).json({ error: "Database error" });
    }

    if (existing) {
      return res.json({ artist: existing, cached: true });
    }

    // 2) not found -> YouTube fetch
    if (!YT_API_KEY) {
      return res.status(500).json({ error: "YouTube API key not configured on backend" });
    }

    const q = artistKey.replace(/-/g, " ");

    // 2a) search channel
    const searchParams = new URLSearchParams({
      key: YT_API_KEY,
      part: "snippet",
      q,
      type: "channel",
      maxResults: "1",
      safeSearch: "none",
    });

    const searchUrl = `https://www.googleapis.com/youtube/v3/search?${searchParams.toString()}`;
    const searchJson = await fetchJson(searchUrl);

    const first = searchJson?.items?.[0];
    const channelId = first?.id?.channelId as string | undefined;

    if (!channelId) {
      // create minimal record (so next time it's cached)
      const minimal = {
        artist: q,
        artist_key: artistKey,
        youtube_channel_id: null,
        description: null,
        thumbnail_url: null,
        banner_url: null,
        subscribers: null,
        views: null,
        country: null,
        source: "youtube",
      };

      const { data: inserted, error: insErr } = await supabase
        .from("artists")
        .upsert(minimal, { onConflict: "artist_key" })
        .select(
          "id, artist, artist_key, youtube_channel_id, description, thumbnail_url, banner_url, subscribers, views, country, source"
        )
        .maybeSingle();

      if (insErr) {
        console.error("[artist] upsert minimal error:", insErr);
        return res.status(500).json({ error: "Failed to store artist" });
      }

      return res.json({ artist: inserted ?? minimal, cached: false, note: "Channel not found" });
    }

    // 2b) channel details
    const chanParams = new URLSearchParams({
      key: YT_API_KEY,
      part: "snippet,statistics,brandingSettings",
      id: channelId,
    });

    const chanUrl = `https://www.googleapis.com/youtube/v3/channels?${chanParams.toString()}`;
    const chanJson = await fetchJson(chanUrl);

    const ch = chanJson?.items?.[0];
    const snippet = ch?.snippet || {};
    const stats = ch?.statistics || {};
    const branding = ch?.brandingSettings || {};

    const thumbnailUrl =
      snippet?.thumbnails?.high?.url ||
      snippet?.thumbnails?.medium?.url ||
      snippet?.thumbnails?.default?.url ||
      null;

    // banner is not always available; pick what exists
    const bannerUrl =
      branding?.image?.bannerExternalUrl ||
      null;

    const record = {
      artist: snippet?.title || q,
      artist_key: artistKey,
      youtube_channel_id: channelId,
      description: snippet?.description || null,
      thumbnail_url: thumbnailUrl,
      banner_url: bannerUrl,
      subscribers: stats?.subscriberCount ? Number(stats.subscriberCount) : null,
      views: stats?.viewCount ? Number(stats.viewCount) : null,
      country: snippet?.country || null,
      source: "youtube",
    };

    // 2c) store + return
    const { data: inserted, error: insErr } = await supabase
      .from("artists")
      .upsert(record, { onConflict: "artist_key" })
      .select(
        "id, artist, artist_key, youtube_channel_id, description, thumbnail_url, banner_url, subscribers, views, country, source"
      )
      .maybeSingle();

    if (insErr) {
      console.error("[artist] upsert error:", insErr);
      return res.status(500).json({ error: "Failed to store artist" });
    }

    return res.json({ artist: inserted ?? record, cached: false });
  } catch (e: any) {
    console.error("[artist] error:", e?.message || e);
    return res.status(500).json({ error: e?.message || "Artist fetch failed" });
  }
});

export default router;
