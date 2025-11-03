import { Heart, Play, MoreHorizontal, Clock } from "lucide-react";
import { Button } from "@/components/ui/button";

const Favorites = () => {
  const favoriteSongs = [
    { id: 1, title: "Omiljena pesma 1", artist: "Izvođač 1", album: "Album 1", duration: "3:45", addedDate: "Pre 2 dana" },
    { id: 2, title: "Omiljena pesma 2", artist: "Izvođač 2", album: "Album 2", duration: "4:12", addedDate: "Pre 3 dana" },
    { id: 3, title: "Omiljena pesma 3", artist: "Izvođač 3", album: "Album 3", duration: "3:28", addedDate: "Pre 5 dana" },
    { id: 4, title: "Omiljena pesma 4", artist: "Izvođač 1", album: "Album 4", duration: "5:01", addedDate: "Pre 1 nedelju" },
    { id: 5, title: "Omiljena pesma 5", artist: "Izvođač 4", album: "Album 5", duration: "3:55", addedDate: "Pre 1 nedelju" },
    { id: 6, title: "Omiljena pesma 6", artist: "Izvođač 2", album: "Album 6", duration: "4:33", addedDate: "Pre 2 nedelje" },
    { id: 7, title: "Omiljena pesma 7", artist: "Izvođač 5", album: "Album 7", duration: "3:18", addedDate: "Pre 2 nedelje" },
    { id: 8, title: "Omiljena pesma 8", artist: "Izvođač 3", album: "Album 8", duration: "4:47", addedDate: "Pre 3 nedelje" },
  ];

  return (
    <div className="flex-1 overflow-y-auto pb-32">
      {/* Header with gradient - responsive */}
      <div className="relative h-48 md:h-80 bg-gradient-to-b from-primary/40 to-background p-4 md:p-8 flex items-end animate-fade-in">
        <div className="flex items-end gap-3 md:gap-6">
          <div className="w-24 h-24 md:w-56 md:h-56 bg-gradient-to-br from-primary/50 via-primary/30 to-primary/20 rounded-lg shadow-2xl flex-shrink-0 flex items-center justify-center">
            <Heart className="w-12 h-12 md:w-28 md:h-28 text-primary fill-primary" />
          </div>
          <div className="pb-2 md:pb-4">
            <p className="text-xs md:text-sm font-semibold mb-1 md:mb-2 uppercase tracking-wider">Plejlista</p>
            <h1 className="text-2xl md:text-6xl font-bold mb-2 md:mb-4">Omiljene pesme</h1>
            <div className="flex items-center gap-2 text-xs md:text-sm">
              <span className="font-semibold">Vaša kolekcija</span>
              <span className="text-muted-foreground">• {favoriteSongs.length} pesama</span>
            </div>
          </div>
        </div>
      </div>

      {/* Controls */}
      <div className="bg-background/95 backdrop-blur-sm sticky top-0 z-10 px-4 md:px-8 py-4 md:py-6 flex items-center gap-4 md:gap-6 animate-slide-up">
        <button className="w-12 h-12 md:w-14 md:h-14 bg-primary rounded-full flex items-center justify-center hover:scale-105 transition-transform shadow-lg">
          <Play className="w-5 h-5 md:w-6 md:h-6 text-background fill-current ml-0.5" />
        </button>
        <button className="text-muted-foreground hover:text-foreground transition-colors">
          <MoreHorizontal className="w-6 h-6 md:w-8 md:h-8" />
        </button>
      </div>

      {/* Song list */}
      <div className="px-8 pb-8">
        {favoriteSongs.length > 0 ? (
          <>
            <div className="grid grid-cols-[16px_6fr_4fr_3fr_minmax(120px,1fr)] gap-4 px-4 py-2 text-sm text-muted-foreground border-b border-border mb-2">
              <div>#</div>
              <div>NASLOV</div>
              <div>ALBUM</div>
              <div>DATUM DODAVANJA</div>
              <div className="flex justify-end">
                <Clock className="w-4 h-4" />
              </div>
            </div>

            <div className="space-y-1">
              {favoriteSongs.map((song, index) => (
                <div
                  key={song.id}
                  className="grid grid-cols-[16px_6fr_4fr_3fr_minmax(120px,1fr)] gap-4 px-4 py-3 rounded-md hover:bg-secondary/50 group cursor-pointer transition-colors"
                >
                  <div className="flex items-center text-muted-foreground group-hover:text-foreground">
                    {index + 1}
                  </div>
                  <div className="flex items-center gap-4 min-w-0">
                    <div className="w-10 h-10 bg-secondary rounded flex-shrink-0 overflow-hidden">
                      <div className="w-full h-full bg-gradient-to-br from-primary/20 to-primary/5" />
                    </div>
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
                  <div className="flex items-center text-sm text-muted-foreground">
                    {song.addedDate}
                  </div>
                  <div className="flex items-center justify-between gap-4">
                    <button className="text-primary hover:scale-110 transition-transform opacity-0 group-hover:opacity-100">
                      <Heart className="w-4 h-4 fill-current" />
                    </button>
                    <span className="text-sm text-muted-foreground">{song.duration}</span>
                  </div>
                </div>
              ))}
            </div>
          </>
        ) : (
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <Heart className="w-20 h-20 text-muted-foreground mb-4" />
            <h3 className="text-2xl font-bold mb-2">Nemate omiljenih pesama</h3>
            <p className="text-muted-foreground mb-6">
              Pesme koje označite kao omiljene će se pojaviti ovde
            </p>
            <Button className="bg-primary text-background hover:bg-primary/90">
              Pronađi muziku
            </Button>
          </div>
        )}
      </div>
    </div>
  );
};

export default Favorites;
