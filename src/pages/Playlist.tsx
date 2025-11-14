"use client";

import { Play, Heart, MoreHorizontal, Clock } from "lucide-react";
import { useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Skeleton } from "@/components/ui/skeleton";
import { usePlayer } from "@/contexts/PlayerContext";

interface Track {
  id: string;
  youtube_id: string;
  title: string;
  artist: string;
  duration: number;
  image_url: string | null;
}

interface Playlist {
  id: string;
  title: string;
  description: string | null;
  cover_url: string | null;
}

interface PlaylistWithTracks extends Playlist {
  tracks: Track[];
}

const Playlist = () => {
  const { id } = useParams();
  const { playTrack, playPlaylist } = usePlayer();

  const { data: playlist, isLoading, error } = useQuery({
    queryKey: ["playlist", id],
    queryFn: async (): Promise<PlaylistWithTracks> => {
      if (!id) throw new Error("Playlist ID is required");

      const { data: playlistData, error: playlistError } = await supabase
        .from("playlists")
        .select("id, title, description, cover_url")
        .eq("id", id)
        .single();

      if (playlistError) throw playlistError;

      const { data: tracks, error: tracksError } = await supabase
        .from("tracks")
        .select("id, youtube_id, title, artist, duration, image_url")
        .eq("playlist_id", id)
        .order("created_at", { ascending: true });

      if (tracksError) throw tracksError;

      return {
        ...playlistData,
        tracks: tracks || [],
      };
    },
    enabled: !!id,
  });

  const formatDuration = (seconds: number | null) => {
    if (!seconds) return '0:00';
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  // Loading state
  if (isLoading) {
    return (
      <div className="flex-1 overflow-y-auto pb-32">
        <div className="relative h-80 bg-gradient-to-b from-purple-900/40 to-background p-8 flex items-end">
          <div className="flex items-end gap-6">
            <Skeleton className="w-56 h-56 rounded-lg" />
            <div className="pb-4 space-y-3">
              <Skeleton className="h-4 w-20" />
              <Skeleton className="h-12 w-64" />
              <Skeleton className="h-4 w-40" />
            </div>
          </div>
        </div>
      </div>
    );
  }

  // Error state
  if (error || !playlist) {
    return (
      <div className="flex-1 overflow-y-auto pb-32 flex items-center justify-center">
        <div className="text-center">
          <h2 className="text-2xl font-bold mb-2">Playlist Not Found</h2>
          <p className="text-muted-foreground">
            The playlist you're looking for doesn't exist or has been removed.
          </p>
        </div>
      </div>
    );
  }

  const cover = playlist.cover_url || "/placeholder.svg";

  return (
    <div className="flex-1 overflow-y-auto pb-32">
      {/* Header with gradient - Dark purple theme - Responsive */}
      <div className="relative bg-gradient-to-b from-purple-900/40 to-background p-4 md:p-8 animate-fade-in">
        <div className="flex flex-col md:flex-row md:items-end gap-4 md:gap-6 max-w-7xl">
          {/* Cover Image - Smaller on all screens */}
          <div className="w-40 h-40 md:w-48 md:h-48 bg-gradient-to-br from-purple-600/30 to-purple-900/10 rounded-lg shadow-2xl flex-shrink-0 overflow-hidden mx-auto md:mx-0">
            <img 
              src={cover} 
              alt={playlist.title} 
              className="w-full h-full object-cover"
              onError={(e) => {
                (e.target as HTMLImageElement).src = "/placeholder.svg";
              }}
            />
          </div>
          {/* Playlist Info - Below cover on mobile, beside on desktop */}
          <div className="pb-4 text-center md:text-left">
            <p className="text-sm font-semibold mb-2 uppercase tracking-wider text-purple-300">
              Playlist
            </p>
            <h1 className="text-3xl md:text-5xl lg:text-6xl font-bold mb-2 md:mb-4">{playlist.title}</h1>
            <p className="text-muted-foreground mb-2 text-sm md:text-base">{playlist.description}</p>
            <div className="flex items-center justify-center md:justify-start gap-2 text-sm">
              <span className="text-muted-foreground">{playlist.tracks.length} songs</span>
            </div>
          </div>
        </div>
      </div>

      {/* Controls */}
      <div className="bg-background/95 backdrop-blur-sm sticky top-0 z-10 px-8 py-6 flex items-center gap-6 animate-slide-up">
        <button 
          onClick={() => {
            if (playlist.tracks.length > 0) {
              const tracksArray = playlist.tracks.map(t => ({ 
                youtube_id: t.youtube_id,
                title: t.title, 
                artist: t.artist 
              }));
              playPlaylist(tracksArray, 0);
            }
          }}
          className="w-14 h-14 bg-purple-600 hover:bg-purple-700 rounded-full flex items-center justify-center hover:scale-105 transition-transform shadow-lg"
        >
          <Play className="w-6 h-6 text-white fill-current ml-0.5" />
        </button>
        <button className="text-muted-foreground hover:text-purple-400 transition-colors">
          <Heart className="w-8 h-8" />
        </button>
        <button className="text-muted-foreground hover:text-foreground transition-colors">
          <MoreHorizontal className="w-8 h-8" />
        </button>
      </div>

      {/* Track list */}
      <div className="px-8 pb-8">
        <div className="grid grid-cols-[16px_minmax(0,1fr)_3fr_minmax(120px,1fr)] gap-4 px-4 py-2 text-sm text-muted-foreground border-b border-border mb-2">
          <div>#</div>
          <div>Title</div>
          <div>Artist</div>
          <div className="flex justify-end">
            <Clock className="w-4 h-4" />
          </div>
        </div>

        <div className="space-y-1">
          {playlist.tracks.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              No tracks in this playlist
            </div>
          ) : (
            playlist.tracks.map((track, index) => (
              <div
                key={track.id}
                onClick={() => {
                  const tracksArray = playlist.tracks.map(t => ({
                    youtube_id: t.youtube_id,
                    title: t.title,
                    artist: t.artist
                  }));
                  playPlaylist(tracksArray, index);
                }}
                className="grid grid-cols-[16px_minmax(0,1fr)_3fr_minmax(120px,1fr)] gap-4 px-4 py-3 rounded-md hover:bg-purple-900/20 group cursor-pointer transition-colors"
              >
                <div className="flex items-center text-muted-foreground group-hover:text-foreground">
                  {index + 1}
                </div>
                <div className="flex items-center gap-3 min-w-0">
                  <div className="w-10 h-10 rounded overflow-hidden flex-shrink-0 bg-purple-900/20">
                    {track.image_url && (
                      <img 
                        src={track.image_url} 
                        alt={track.title}
                        className="w-full h-full object-cover"
                        onError={(e) => {
                          (e.target as HTMLImageElement).style.display = 'none';
                        }}
                      />
                    )}
                  </div>
                  <div className="min-w-0">
                    <p className="font-medium truncate group-hover:text-purple-400 transition-colors">
                      {track.title}
                    </p>
                    <p className="text-sm text-muted-foreground truncate">{track.artist}</p>
                  </div>
                </div>
                <div className="flex items-center text-sm text-muted-foreground truncate">
                  {track.artist}
                </div>
                <div className="flex items-center justify-end text-sm text-muted-foreground">
                  {formatDuration(track.duration)}
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
};

export default Playlist;
