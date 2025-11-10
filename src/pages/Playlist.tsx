import { Play, Heart, MoreHorizontal, Clock } from "lucide-react";
import { useParams } from "react-router-dom";
import { useLanguage } from "@/contexts/LanguageContext";

const Playlist = () => {
  const { t } = useLanguage();
  const { id } = useParams();

  const songs = [
    { id: 1, title: "Pesma 1", artist: "Izvođač 1", album: "Album 1", duration: "3:45" },
    { id: 2, title: "Pesma 2", artist: "Izvođač 2", album: "Album 2", duration: "4:12" },
    { id: 3, title: "Pesma 3", artist: "Izvođač 1", album: "Album 3", duration: "3:28" },
    { id: 4, title: "Pesma 4", artist: "Izvođač 3", album: "Album 1", duration: "5:01" },
    { id: 5, title: "Pesma 5", artist: "Izvođač 2", album: "Album 4", duration: "3:55" },
    { id: 6, title: "Pesma 6", artist: "Izvođač 4", album: "Album 2", duration: "4:33" },
    { id: 7, title: "Pesma 7", artist: "Izvođač 1", album: "Album 5", duration: "3:18" },
    { id: 8, title: "Pesma 8", artist: "Izvođač 3", album: "Album 3", duration: "4:47" },
  ];

  return (
    <div className="flex-1 overflow-y-auto pb-32">
      {/* Header with gradient */}
      <div className="relative h-80 bg-gradient-to-b from-primary/40 to-background p-8 flex items-end animate-fade-in">
        <div className="flex items-end gap-6">
          <div className="w-56 h-56 bg-gradient-to-br from-primary/30 to-primary/10 rounded-lg shadow-2xl flex-shrink-0" />
          <div className="pb-4">
            <p className="text-sm font-semibold mb-2 uppercase tracking-wider">{t("playlist")}</p>
            <h1 className="text-6xl font-bold mb-4">{t("my_playlist")} #{id}</h1>
            <div className="flex items-center gap-2 text-sm">
              <span className="font-semibold">{t("user")}</span>
              <span className="text-muted-foreground">• {songs.length} {t("songs")}</span>
            </div>
          </div>
        </div>
      </div>

      {/* Controls */}
      <div className="bg-background/95 backdrop-blur-sm sticky top-0 z-10 px-8 py-6 flex items-center gap-6 animate-slide-up">
        <button className="w-14 h-14 bg-primary rounded-full flex items-center justify-center hover:scale-105 transition-transform shadow-lg">
          <Play className="w-6 h-6 text-background fill-current ml-0.5" />
        </button>
        <button className="text-muted-foreground hover:text-primary transition-colors">
          <Heart className="w-8 h-8" />
        </button>
        <button className="text-muted-foreground hover:text-foreground transition-colors">
          <MoreHorizontal className="w-8 h-8" />
        </button>
      </div>

      {/* Song list */}
      <div className="px-8 pb-8">
        <div className="grid grid-cols-[16px_6fr_4fr_3fr_minmax(120px,1fr)] gap-4 px-4 py-2 text-sm text-muted-foreground border-b border-border mb-2">
          <div>#</div>
          <div>{t("title")}</div>
          <div>{t("album")}</div>
          <div>{t("date_added")}</div>
          <div className="flex justify-end">
            <Clock className="w-4 h-4" />
          </div>
        </div>

        <div className="space-y-1">
          {songs.map((song, index) => (
            <div
              key={song.id}
              className="grid grid-cols-[16px_6fr_4fr_3fr_minmax(120px,1fr)] gap-4 px-4 py-3 rounded-md hover:bg-secondary/50 group cursor-pointer transition-colors"
            >
              <div className="flex items-center text-muted-foreground group-hover:text-foreground">
                {index + 1}
              </div>
              <div className="flex items-center min-w-0">
                <div className="min-w-0">
                  <p className="font-medium truncate group-hover:text-primary transition-colors">
                    {song.title}
                  </p>
                  <p className="text-sm text-muted-foreground truncate">{song.artist}</p>
                </div>
              </div>
              <div className="flex items-center text-sm text-muted-foreground truncate">
                {song.album}
              </div>
              <div className="flex items-center text-sm text-muted-foreground">Pre 2 dana</div>
              <div className="flex items-center justify-end text-sm text-muted-foreground">
                {song.duration}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

export default Playlist;
