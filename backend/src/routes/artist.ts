import { Router } from "express";
import { supabaseAdmin } from "../lib/supabaseAdmin";

const router = Router();

const YT_API_KEY = process.env.YOUTUBE_API_KEY;

router.get("/:artistKey", async (req, res) => {
  const { artistKey } = req.params;

  try {
    // 1️⃣ Pokušaj iz baze
    const { data: existing, error } = await supabaseAdmin
      .from("artists")
      .select("*")
      .eq("artist_key", artistKey)
      .maybeSingle();

    if (existing) {
      return res.json(existing);
    }

    // 2️⃣ Ako ne postoji → YouTube search (channel)
    if (!YT_API_KEY) {
      return res.status(500).json({ error: "YouTube API key missing" });
    }

    const ytRes = await fetch(
      `https://www.googleapis.com/youtube/v3/search?${new URLSearchParams({
        part: "snippet",
        q: artistKey.replace(/-/g, " "),
        type: "channel",
        maxResults: "1",
        key: YT_API_KEY,
      })}`
    );

    const ytJson: any = await ytRes.json();
    const item = ytJson.items?.[0];

    if (!item) {
      return res.status(404).json({ error: "Artist not found on YouTube" });
    }

    const artist = {
      artist: item.snippet.title,
      artist_key: artistKey,
      youtube_channel_id: item.id.channelId,
      thumbnail: item.snippet.thumbnails?.high?.url ?? null,
      created_at: new Date().toISOString(),
    };

    // 3️⃣ Snimi u bazu
    const { data: inserted, error: insertError } = await supabaseAdmin
      .from("artists")
      .insert(artist)
      .select()
      .single();

    if (insertError) {
      return res.status(500).json(insertError);
    }

    return res.json(inserted);
  } catch (e) {
    console.error("ARTIST ROUTE ERROR:", e);
    return res.status(500).json({ error: "Internal error" });
  }
});

export default router;
