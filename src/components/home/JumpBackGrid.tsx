import { useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { Music } from "lucide-react";
import { useQuery } from "@tanstack/react-query";

import { Skeleton } from "@/components/ui/skeleton";
import { usePi } from "@/contexts/PiContext";
import { withBackendOrigin } from "@/lib/backendUrl";
import { externalSupabase } from "@/lib/externalSupabase";

interface RecentPlaylist {
  id: string;
  title: string;
  cover_url: string | null;
  view_count: number;
  last_viewed_at: string;
}

interface PlaylistData {
  id: string;
  title: string;
  cover_url: string | null;
}

const GRID_CLASS = "grid grid-cols-2 gap-1.5";
const CARD_CLASS = "flex h-14 w-full items-center gap-2 rounded-xl bg-[#1a1a1a] p-1";
const THUMB_CLASS = "h-12 w-12 flex-shrink-0 rounded-md bg-black/40 flex items-center justify-center";

const JumpBackGrid = () => {
  const { user } = usePi();
  const navigate = useNavigate();

  const isLoggedIn = Boolean(user?.uid);

  const { data: playlists, isLoading } = useQuery({
    queryKey: ["recent-playlists", user?.uid],
    enabled: isLoggedIn,
    queryFn: async () => {
      const userId = user?.uid;
      if (!userId) return [];

      const url = withBackendOrigin(`/api/playlist-views/top?user_id=${encodeURIComponent(userId)}&limit=6`);
      const response = await fetch(url, {
        credentials: "include",
        headers: { "Content-Type": "application/json" },
      });

      if (!response.ok) {
        console.error("Error fetching recent playlists:", response.status);
        return [];
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
        return [];
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

      return merged.filter((item) => item.id);
    },
  });

  const gridPlaylists = useMemo(() => (playlists ? playlists.slice(0, 6) : []), [playlists]);

  if (!isLoggedIn) return null;

  if (isLoading) {
    return (
      <div className={GRID_CLASS} style={{ gridTemplateRows: "repeat(3, auto)" }}>
        {Array.from({ length: 6 }).map((_, index) => (
          <Skeleton key={index} className="h-14 rounded-xl bg-[#1a1a1a]" />
        ))}
      </div>
    );
  }

  if (!gridPlaylists.length) {
    return null;
  }

  return (
    <div className={GRID_CLASS} style={{ gridTemplateRows: "repeat(3, auto)" }}>
      {gridPlaylists.map((playlist: RecentPlaylist) => (
        <button
          key={playlist.id}
          type="button"
          className={CARD_CLASS}
          onClick={() => navigate(`/playlist/${playlist.id}`)}
          aria-label={`Open playlist ${playlist.title}`}
        >
          <div className={THUMB_CLASS}>
            {playlist.cover_url ? (
              <img src={playlist.cover_url} alt={playlist.title} className="h-full w-full object-contain object-center" />
            ) : (
              <div className="flex h-full w-full items-center justify-center bg-gradient-to-br from-primary/20 to-primary/5">
                <Music className="h-3.5 w-3.5 text-primary/30" />
              </div>
            )}
          </div>

          <div className="min-w-0 flex-1">
            <p className="truncate text-[12px] font-medium leading-tight text-foreground">{playlist.title}</p>
          </div>
        </button>
      ))}
    </div>
  );
};

export default JumpBackGrid;
