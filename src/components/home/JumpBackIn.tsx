import { useQuery } from "@tanstack/react-query";
import { externalSupabase } from "@/lib/externalSupabase";
import { Link } from "react-router-dom";
import { Music, Play } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";

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
  const { data: playlists, isLoading } = useQuery({
    queryKey: ["recent-playlists"],
    queryFn: async () => {
      // Get user's most opened playlists
      // Since we don't have auth yet, we'll use a demo user_id or fetch all
      // In production, replace with actual user_id from auth context
      const demoUserId = "00000000-0000-0000-0000-000000000000";

      const { data: viewData, error: viewError } = await externalSupabase
        .from("playlist_views")
        .select("playlist_id, view_count, last_viewed_at")
        .eq("user_id", demoUserId)
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

      return merged as RecentPlaylist[];
    },
  });

  // Grid pattern: [0,2,4] in first row, [1,3,5] in second row (Spotify style)
  const reorderForGrid = (items: RecentPlaylist[]) => {
    if (!items || items.length === 0) return [];
    const reordered: RecentPlaylist[] = [];
    const firstRow = [0, 2, 4];
    const secondRow = [1, 3, 5];
    
    firstRow.forEach(i => {
      if (items[i]) reordered.push(items[i]);
    });
    secondRow.forEach(i => {
      if (items[i]) reordered.push(items[i]);
    });
    
    return reordered;
  };

  const gridPlaylists = playlists ? reorderForGrid(playlists) : [];

  if (isLoading) {
    return (
      <div className="mb-8">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-16 rounded-md" />
          ))}
        </div>
      </div>
    );
  }

  if (!gridPlaylists || gridPlaylists.length === 0) {
    return null;
  }

  return (
    <div className="mb-8">
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
        {gridPlaylists.map((playlist) => (
          <Link
            key={playlist.id}
            to={`/playlist/${playlist.id}`}
            className="group relative bg-card hover:bg-secondary/80 rounded-md overflow-hidden transition-all duration-300 h-16 flex items-center"
          >
            {/* Cover Image */}
            <div className="w-16 h-16 flex-shrink-0 bg-muted">
              {playlist.cover_url ? (
                <img
                  src={playlist.cover_url}
                  alt={playlist.title}
                  className="w-full h-full object-cover"
                />
              ) : (
                <div className="w-full h-full bg-gradient-to-br from-primary/20 to-primary/5 flex items-center justify-center">
                  <Music className="w-6 h-6 text-primary/30" />
                </div>
              )}
            </div>

            {/* Title */}
            <div className="flex-1 px-3 min-w-0">
              <h3 className="font-semibold text-sm text-foreground truncate">
                {playlist.title}
              </h3>
            </div>

            {/* Play button on hover */}
            <div className="absolute right-2 opacity-0 group-hover:opacity-100 transition-opacity duration-200">
              <div className="w-10 h-10 rounded-full bg-primary flex items-center justify-center shadow-lg hover:scale-105 transition-transform">
                <Play className="w-5 h-5 text-primary-foreground fill-current ml-0.5" />
              </div>
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
};

export default JumpBackIn;
