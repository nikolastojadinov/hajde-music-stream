import { useQuery } from "@tanstack/react-query";
import { externalSupabase } from "@/lib/externalSupabase";
import { withBackendOrigin } from "@/lib/backendUrl";
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
  
  const getRandomPlaylistsFallback = async (): Promise<RecentPlaylist[]> => {
    const { data: fallbackData } = await externalSupabase
      .from("playlists")
      .select("id, title, cover_url")
      .limit(6);

    return ((fallbackData || []) as PlaylistData[]).map((p: PlaylistData) => ({
      ...p,
      view_count: 0,
      last_viewed_at: new Date().toISOString(),
    }));
  };

  const { data: playlists, isLoading } = useQuery({
    queryKey: ["recent-playlists", user?.uid],
    queryFn: async () => {
      // Get real user ID from Pi context
      const userId = user?.uid;

      if (!userId) {
        // No user logged in - show 6 random playlists
        return getRandomPlaylistsFallback();
      }

      const url = withBackendOrigin(`/api/playlist-views/top?user_id=${encodeURIComponent(userId)}&limit=6`);
      const response = await fetch(url, {
        credentials: "include",
        headers: {
          "Content-Type": "application/json",
        },
      });

      if (!response.ok) {
        console.error("Error fetching recent playlists:", response.status);
        return getRandomPlaylistsFallback();
      }

      const payload = await response.json().catch(() => null);
      type BackendPlaylistItem = {
        playlist_id?: string;
        view_count?: number;
        last_viewed_at?: string;
        playlists?: PlaylistData;
        playlist?: PlaylistData;
      };

      const backendPlaylists: BackendPlaylistItem[] = Array.isArray(payload?.playlists)
        ? (payload!.playlists as BackendPlaylistItem[])
        : [];

      if (!backendPlaylists.length) {
        return getRandomPlaylistsFallback();
      }

      const merged = backendPlaylists.map((item) => {
        const playlist: Partial<PlaylistData> = item.playlists || item.playlist || {};
        return {
          id: playlist.id ?? item.playlist_id ?? "",
          title: playlist.title ?? "Unknown Playlist",
          cover_url: playlist.cover_url ?? null,
          view_count: item.view_count ?? 0,
          last_viewed_at: item.last_viewed_at ?? new Date().toISOString(),
        } satisfies RecentPlaylist;
      });

      // If user has less than 6 playlists, fill with random ones
      const validMerged = merged.filter((item) => item.id);

      if (validMerged.length < 6) {
        const existingIds = validMerged.map(p => p.id);
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
          validMerged.push(...randomPlaylists);
        }
      }

      return validMerged;
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
      {gridPlaylists.map((playlist: RecentPlaylist) => (
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
