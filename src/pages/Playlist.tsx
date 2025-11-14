import { useState } from "react";
import { useParams } from "react-router-dom";
import { Play, Pause } from "lucide-react";
import { Button } from "@/components/ui/button";
import { usePlayer } from "@/contexts/PlayerContext";
import { Skeleton } from "@/components/ui/skeleton";
import { useExternalPlaylist } from "@/hooks/useExternalPlaylist";

const Playlist = () => {
  const { id } = useParams<{ id: string }>();
  const { playPlaylist, isPlaying, togglePlay } = usePlayer();
  const [currentTrackId, setCurrentTrackId] = useState<string | null>(null);

  const { data: playlist, isLoading, error } = useExternalPlaylist(id || "");

  const formatDuration = (seconds: number | null) => {
    if (!seconds) return "0:00";
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, "0")}`;
  };

  const handlePlayPlaylist = () => {
    if (playlist && playlist.tracks.length > 0) {
      const trackData = playlist.tracks.map(t => ({
        youtube_id: t.youtube_id,
        title: t.title,
        artist: t.artist
      }));
      playPlaylist(trackData, 0);
      setCurrentTrackId(playlist.tracks[0].id);
    }
  };

  const handlePlayTrack = (track: any, index: number) => {
    if (playlist) {
      const trackData = playlist.tracks.map(t => ({
        youtube_id: t.youtube_id,
        title: t.title,
        artist: t.artist
      }));
      playPlaylist(trackData, index);
      setCurrentTrackId(track.id);
    }
  };

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
        <div className="text-center">
          <h2 className="text-2xl font-bold mb-2">Plejlista nije pronađena</h2>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto pb-32">
      <div className="relative bg-gradient-to-b from-purple-900/40 to-background p-4 md:p-8">
        <div className="flex flex-col md:flex-row md:items-end gap-4">
          <div className="w-40 h-40 md:w-48 md:h-48 rounded-lg overflow-hidden">
            <img src={playlist.image_url || "/placeholder.svg"} alt={playlist.title} className="w-full h-full object-cover" />
          </div>
          <div>
            <h1 className="text-3xl md:text-5xl font-black">{playlist.title}</h1>
            <p className="text-sm text-gray-400 mt-2">{playlist.tracks.length} pesama</p>
          </div>
        </div>
      </div>

      <div className="p-4 md:p-8">
        <Button size="lg" className="rounded-full mb-6" onClick={handlePlayPlaylist}>
          <Play className="w-5 h-5 mr-2 fill-current" />
          Pusti plejlistu
        </Button>

        <div className="space-y-1">
          {playlist.tracks.map((track, index) => {
            const isCurrent = currentTrackId === track.id;
            return (
              <div
                key={track.id}
                className={`group flex items-center gap-4 p-3 rounded-lg hover:bg-white/5 cursor-pointer ${isCurrent ? "bg-white/10" : ""}`}
                onClick={() => handlePlayTrack(track, index)}
              >
                <div className="w-8 text-center">
                  {isCurrent ? (
                    <button onClick={(e) => { e.stopPropagation(); togglePlay(); }} className="text-primary">
                      {isPlaying ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4" />}
                    </button>
                  ) : (
                    <span className="text-sm text-muted-foreground group-hover:hidden">{index + 1}</span>
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <div className={`font-medium truncate ${isCurrent ? "text-primary" : ""}`}>{track.title}</div>
                  <div className="text-sm text-muted-foreground truncate">{track.artist}</div>
                </div>
                <div className="text-sm text-muted-foreground">{formatDuration(track.duration)}</div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};

export default Playlist;
