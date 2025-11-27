import { useQuery } from "@tanstack/react-query";
import { externalSupabase } from "@/lib/externalSupabase";
import { Link } from "react-router-dom";
import { Music } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { usePi } from "@/contexts/PiContext";

interface RecentPlaylist {
  id: string;
  title: string;
  cover_url: string | null;
  view_count: number;
  last_viewed_at: string;
}

interface PlaylistView {
  playlist_id: string;
  view_count: number;
  last_viewed_at: string;
}

interface PlaylistData {
  id: string;
  title: string;
  cover_url: string | null;
}

const JumpBackIn = () => {
  const { user } = usePi();
  
  const { data: playlists, isLoading } = useQuery({
    queryKey: ["recent-playlists", user?.uid],
    queryFn: async () => {
      // Get real user ID from Pi context
      const userId = user?.uid;

      if (!userId) {
        // No user logged in - show 6 random playlists
        const { data: fallbackData } = await externalSupabase
          .from("playlists")
          .select("id, title, cover_url")
          .limit(6);
        
        return ((fallbackData || []) as PlaylistData[]).map((p: PlaylistData) => ({
          ...p,
          view_count: 0,
          last_viewed_at: new Date().toISOString()
        }));
      }

      const { data: viewData, error: viewError } = await externalSupabase
        .from("playlist_views")
        .select("playlist_id, view_count, last_viewed_at")
        .eq("user_id", userId)
        .order("view_count", { ascending: false })
        .order("last_viewed_at", { ascending: false })
        .limit(6);

      if (viewError) {
        console.error("Error fetching recent playlists:", viewError);
        // Fallback: get 6 random playlists
        const { data: fallbackData } = await externalSupabase
          .from("playlists")
          .select("id, title, cover_url")
          .limit(6);
        
        return ((fallbackData || []) as PlaylistData[]).map((p: PlaylistData) => ({
          ...p,
          view_count: 0,
          last_viewed_at: new Date().toISOString()
        }));
      }

      if (!viewData || viewData.length === 0) {
        // No view history - get 6 random playlists
        const { data: fallbackData } = await externalSupabase
          .from("playlists")
          .select("id, title, cover_url")
          .limit(6);
        
        return ((fallbackData || []) as PlaylistData[]).map((p: PlaylistData) => ({
          ...p,
          view_count: 0,
          last_viewed_at: new Date().toISOString()
        }));
      }

      // Fetch playlist details
      const playlistIds = (viewData as PlaylistView[]).map((v: PlaylistView) => v.playlist_id);
      const { data: playlistData, error: playlistError } = await externalSupabase
        .from("playlists")
        .select("id, title, cover_url")
        .in("id", playlistIds);

      if (playlistError) throw playlistError;

      // Merge view stats with playlist data
      const merged = (viewData as PlaylistView[]).map((view: PlaylistView) => {
        const playlist = (playlistData as PlaylistData[] | null)?.find((p: PlaylistData) => p.id === view.playlist_id);
        return {
          id: view.playlist_id,
          title: playlist?.title || "Unknown Playlist",
          cover_url: playlist?.cover_url || null,
          view_count: view.view_count,
          last_viewed_at: view.last_viewed_at,
        };
      });

      // If user has less than 6 playlists, fill with random ones
      if (merged.length < 6) {
        const existingIds = merged.map(p => p.id);
        const needed = 6 - merged.length;
        
        const { data: randomData } = await externalSupabase
          .from("playlists")
          .select("id, title, cover_url")
          .not("id", "in", `(${existingIds.join(",")})`)
          .limit(needed);
        
        if (randomData && randomData.length > 0) {
          const randomPlaylists = (randomData as PlaylistData[]).map((p: PlaylistData) => ({
            ...p,
            view_count: 0,
            last_viewed_at: new Date().toISOString()
          }));
          merged.push(...randomPlaylists);
        }
      }

      return merged as RecentPlaylist[];
    },
    enabled: true, // Always fetch, even if no user (will show random)
  });

  const gridPlaylists = playlists ? playlists.slice(0, 6) : [];

  if (isLoading) {
    return (
      <div
        className="grid grid-cols-2 gap-3"
        style={{ gridTemplateRows: "repeat(3, auto)" }}
      >
        {Array.from({ length: 6 }).map((_, i) => (
          <Skeleton key={i} className="h-20 rounded-lg" />
        ))}
      </div>
    );
  }

  if (!gridPlaylists || gridPlaylists.length === 0) {
    return null;
  }

  return (
    <div
      className="grid grid-cols-2 gap-3"
      style={{ gridTemplateRows: "repeat(3, auto)" }}
    >
      {gridPlaylists.map((playlist) => (
        <Link
          key={playlist.id}
          to={`/playlist/${playlist.id}`}
          className="flex h-20 items-center gap-2 overflow-hidden rounded-lg bg-[#111111] p-1.5"
        >
          {/* Small Cover Image - 58x58px */}
          <div className="h-[58px] w-[58px] flex-shrink-0 overflow-hidden rounded-md bg-muted">
            {playlist.cover_url ? (
              <img
                src={playlist.cover_url}
                alt={playlist.title}
                className="w-full h-full object-cover"
              />
            ) : (
              <div className="w-full h-full bg-gradient-to-br from-primary/20 to-primary/5 flex items-center justify-center">
                <Music className="h-4 w-4 text-primary/30" />
              </div>
            )}
          </div>

          {/* Text Area - Playlist Title */}
          <div className="min-w-0 flex-1">
            <h3 className="truncate text-xs font-medium leading-tight text-foreground">
              {playlist.title}
            </h3>
          </div>
        </Link>
      ))}
    </div>
  );
};

export default JumpBackIn;
