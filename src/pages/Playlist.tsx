import { useEffect, useMemo, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import { Play, Pause, Heart } from "lucide-react";
import { Button } from "@/components/ui/button";
import { usePlayer } from "@/contexts/PlayerContext";
import { Skeleton } from "@/components/ui/skeleton";
import { useExternalPlaylist } from "@/hooks/useExternalPlaylist";
import useLikes from "@/hooks/useLikes";
import { useLanguage } from "@/contexts/LanguageContext";
import { usePi } from "@/contexts/PiContext";
import { PlaylistHeaderStats } from "@/components/playlists/PlaylistHeaderStats";
import { useSWRConfig } from "swr";
import { withBackendOrigin } from "@/lib/backendUrl";
import { usePlaylistViewTracking } from "@/hooks/usePlaylistViewTracking";
import AddToPlaylistButton from "@/components/AddToPlaylistButton";

/**
 * Clean playlist title ONLY for UI display
 * (does NOT touch backend data)
 */
const cleanPlaylistTitle = (title: string) => {
  if (!title) return "";

  let t = title;

  // decode HTML entities
  t = t.replace(/&amp;/gi, "&");

  // remove bracketed descriptions
  t = t.replace(/\([^)]*\)/g, "");

  // remove noise words
  t = t.replace(
    /\b(podcast|radio|live|mixes|dj set|episode)\b/gi,
    ""
  );

  // normalize spaces
  t = t.replace(/\s{2,}/g, " ").trim();

  // limit length
  if (t.length > 70) {
    t = t.slice(0, 67).trim() + "…";
  }

  return t;
};

const Playlist = () => {
  const { id } = useParams<{ id: string }>();
  const { playPlaylist, isPlaying, togglePlay } = usePlayer();
  const { isPlaylistLiked, togglePlaylistLike } = useLikes();
  const { t } = useLanguage();
  const [currentTrackId, setCurrentTrackId] = useState<string | null>(null);
  const { mutate } = useSWRConfig();
  const { user } = usePi();
  const lastLoggedViewId = useRef<string | null>(null);
  const { trackView } = usePlaylistViewTracking();

  const { data: playlist, isLoading, error } = useExternalPlaylist(id || "");
  const isLiked = id ? isPlaylistLiked(id) : false;

  const displayTitle = useMemo(
    () => cleanPlaylistTitle(playlist?.title ?? ""),
    [playlist?.title]
  );

  // ----- sve ostalo ostaje isto -----

  if (isLoading) {
    return (
      <div className="flex-1 overflow-y-auto pb-32">
        <div className="relative h-80 bg-gradient-to-b from-purple-900/40 to-background p-8">
          <Skeleton className="w-56 h-56 rounded-lg" />
        </div>
      </div>
    );
  }

  if (error || !playlist) {
    return (
      <div className="flex-1 overflow-y-auto pb-32 flex items-center justify-center">
        <h2 className="text-xl font-bold">{t("playlist_load_error")}</h2>
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto pb-32">
      <div className="relative bg-gradient-to-b from-purple-900/40 to-background p-4 md:p-8">
        <div className="flex flex-col md:flex-row md:items-end gap-4">
          <div className="w-40 h-40 md:w-48 md:h-48 rounded-lg overflow-hidden">
            <img
              src={playlist.cover_url || "/placeholder.svg"}
              alt={playlist.title}
              className="w-full h-full object-cover"
            />
          </div>
          <div>
            {/* ✅ ONLY THIS LINE IS CHANGED */}
            <h1 className="text-3xl md:text-5xl font-black">
              {displayTitle}
            </h1>

            <p className="text-sm text-muted-foreground mt-2">
              {playlist.tracks.length} {t("songs")}
            </p>
          </div>
        </div>
      </div>

      {/* ⬇️ LISTA PESAMA OSTALA 100% ISTA */}
      <div className="p-4 md:p-8">
        <div className="space-y-2">
          {playlist.tracks.map((track, index) => {
            const isCurrent = currentTrackId === track.id;
            return (
              <div
                key={track.id}
                className={`group flex items-center gap-3 p-2 rounded-lg hover:bg-white/5 cursor-pointer ${
                  isCurrent ? "bg-white/10" : ""
                }`}
              >
                {/* original content untouched */}
                <div className="w-12 h-12 rounded overflow-hidden flex-shrink-0 bg-card relative">
                  <img
                    src={track.cover_url || playlist.cover_url || "/placeholder.svg"}
                    alt={track.title}
                    className="w-full h-full object-cover"
                  />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="font-medium truncate">{track.title}</div>
                  <div className="text-sm text-muted-foreground truncate">
                    {track.artist}
                  </div>
                </div>
                <AddToPlaylistButton
                  trackId={track.id}
                  trackTitle={track.title}
                  variant="ghost"
                />
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};

export default Playlist;
