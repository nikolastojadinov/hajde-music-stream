import { useEffect, useState } from "react";
import { Search as SearchIcon, Youtube } from "lucide-react";
import { Input } from "@/components/ui/input";
import { usePlayer } from "@/contexts/PlayerContext";
import { externalSupabase } from "@/lib/externalSupabase";

interface YoutubeVideo {
  videoId: string;
  title: string;
  channelTitle: string;
  thumbnail: string | null;
  alreadyExists: boolean;
}

const ytApiKey = import.meta.env.VITE_YOUTUBE_API_KEY as string;

const Search = () => {
  const { playTrack } = usePlayer();

  const [query, setQuery] = useState("");
  const [debounced, setDebounced] = useState("");
  const [loading, setLoading] = useState(false);
  const [videos, setVideos] = useState<YoutubeVideo[]>([]);
  const [error, setError] = useState<string | null>(null);

  // debounce
  useEffect(() => {
    const t = setTimeout(() => setDebounced(query.trim()), 400);
    return () => clearTimeout(t);
  }, [query]);

  // MAIN SEARCH
  useEffect(() => {
    if (!debounced || !ytApiKey) {
      setVideos([]);
      return;
    }

    const run = async () => {
      setLoading(true);
      setError(null);

      try {
        // 1️⃣ YouTube MUSIC VIDEO SEARCH
        const searchParams = new URLSearchParams({
          key: ytApiKey,
          part: "snippet",
          q: debounced,
          type: "video",
          videoCategoryId: "10", // MUSIC ONLY
          maxResults: "12",
          safeSearch: "none",
        });

        const searchRes = await fetch(
          `https://www.googleapis.com/youtube/v3/search?${searchParams}`
        );

        if (!searchRes.ok) {
          throw new Error(await searchRes.text());
        }

        const searchJson = await searchRes.json();
        const items = searchJson.items || [];

        const mapped = await Promise.all(
          items.map(async (item: any) => {
            const videoId = item.id.videoId;
            const title = item.snippet.title;
            const channelTitle = item.snippet.channelTitle;

            // 2️⃣ CHECK IF EXISTS IN SUPABASE
            const { data } = await externalSupabase
              .from("tracks")
              .select("id")
              .eq("external_id", videoId)
              .eq("source", "youtube")
              .maybeSingle();

            return {
              videoId,
              title,
              channelTitle,
              thumbnail:
                item.snippet.thumbnails?.high?.url ||
                item.snippet.thumbnails?.medium?.url ||
                null,
              alreadyExists: Boolean(data),
            };
          })
        );

        setVideos(mapped);
      } catch (err: any) {
        console.error(err);
        setError("YouTube search failed");
      } finally {
        setLoading(false);
      }
    };

    run();
  }, [debounced]);

  // IMPORT + PLAY
  const importAndPlay = async (videoId: string) => {
    const params = new URLSearchParams({
      key: ytApiKey,
      part: "snippet,contentDetails",
      id: videoId,
      fields:
        "items(id,snippet(title,channelTitle,thumbnails(high(url))),contentDetails(duration))",
    });

    const res = await fetch(
      `https://www.googleapis.com/youtube/v3/videos?${params}`
    );
    const json = await res.json();
    const video = json.items?.[0];
    if (!video) return;

    const title = video.snippet.title;
    const artist = video.snippet.channelTitle;
    const cover = video.snippet.thumbnails?.high?.url || null;

    const { data } = await externalSupabase
      .from("tracks")
      .upsert(
        {
          source: "youtube",
          external_id: videoId,
          title,
          artist,
          cover_url: cover,
        },
        { onConflict: "external_id" }
      )
      .select("id, external_id, title, artist")
      .maybeSingle();

    if (data) {
      playTrack(data.external_id, data.title, data.artist, data.id);
    }
  };

  return (
    <div className="p-4 pb-32 max-w-3xl mx-auto">
      {/* SEARCH INPUT */}
      <div className="relative mb-6">
        <SearchIcon className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-muted-foreground" />
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search songs or artists"
          className="pl-12 h-12"
        />
      </div>

      {/* STATES */}
      {loading && <p className="text-muted-foreground">Searching YouTube…</p>}
      {error && <p className="text-red-400">{error}</p>}

      {/* RESULTS */}
      <div className="space-y-6">
        {videos.map((v) => (
          <div
            key={v.videoId}
            className="flex gap-4 items-center bg-card rounded-lg p-3"
          >
            {v.thumbnail && (
              <img
                src={v.thumbnail}
                className="w-28 aspect-video object-cover rounded"
              />
            )}

            <div className="flex-1">
              <h3 className="font-semibold text-foreground line-clamp-2">
                {v.title}
              </h3>
              <p className="text-xs text-muted-foreground">
                {v.channelTitle}
              </p>
            </div>

            {v.alreadyExists ? (
              <span className="text-xs text-green-400">In library</span>
            ) : (
              <button
                onClick={() => importAndPlay(v.videoId)}
                className="text-sm px-3 py-1 rounded border border-yellow-500 text-yellow-400 hover:bg-yellow-500/10"
              >
                Import
              </button>
            )}
          </div>
        ))}
      </div>
    </div>
  );
};

export default Search;
