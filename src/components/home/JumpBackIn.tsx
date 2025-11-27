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
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 max-h-[400px]">
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
    <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 max-h-[400px]">
      {gridPlaylists.slice(0, 6).map((playlist) => (
        <Link
          key={playlist.id}
          to={`/playlist/${playlist.id}`}
          className="group bg-[#101013] hover:bg-[#1a1a1d] rounded-lg transition-colors duration-200 p-2 flex items-center gap-2.5 h-20"
        >
          {/* Small Cover Image - 68x68px */}
          <div className="w-[68px] h-[68px] rounded-md overflow-hidden bg-muted flex-shrink-0">
            {playlist.cover_url ? (
              <img
                src={playlist.cover_url}
                alt={playlist.title}
                className="w-full h-full object-cover"
              />
            ) : (
              <div className="w-full h-full bg-gradient-to-br from-primary/20 to-primary/5 flex items-center justify-center">
                <Music className="w-5 h-5 text-primary/30" />
              </div>
            )}
          </div>

          {/* Text Area - Playlist Title */}
          <div className="flex-1 min-w-0">
            <h3 className="font-medium text-xs leading-tight text-foreground line-clamp-2">
              {playlist.title}
            </h3>
          </div>
        </Link>
      ))}
    </div>
  );
};

export default JumpBackIn;
