import { Music, Heart, User } from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import PlaylistCard from "@/components/PlaylistCard";
import { useLanguage } from "@/contexts/LanguageContext";

const Library = () => {
  const { t } = useLanguage();
  
  const playlists = [
    { id: "1", title: "Moja Plejlista #1", description: "50 pesama" },
    { id: "2", title: "Chill Vibes", description: "32 pesme" },
    { id: "3", title: "Workout Mix", description: "45 pesama" },
    { id: "4", title: "Party Hits", description: "67 pesama" },
  ];

  const albums = [
    { id: "1", title: "Album 1", description: "Izvođač 1 • 2023" },
    { id: "2", title: "Album 2", description: "Izvođač 2 • 2023" },
    { id: "3", title: "Album 3", description: "Izvođač 3 • 2024" },
  ];

  const artists = [
    { id: "1", title: "Izvođač 1", description: "1.2M pratilaca" },
    { id: "2", title: "Izvođač 2", description: "856K pratilaca" },
    { id: "3", title: "Izvođač 3", description: "2.1M pratilaca" },
  ];

  return (
    <div className="flex-1 overflow-y-auto pb-32">
      <div className="p-8">
        <h1 className="text-4xl font-bold mb-8 animate-fade-in">{t("your_library")}</h1>

        <Tabs defaultValue="playlists" className="w-full animate-slide-up">
          <TabsList className="bg-secondary mb-8 w-full sm:w-auto">
            <TabsTrigger value="playlists" className="gap-1 sm:gap-2 w-32 sm:w-40">
              <Music className="w-3 h-3 sm:w-4 sm:h-4 flex-shrink-0" />
              <span className="text-xs sm:text-sm leading-tight text-center">{t("library_playlists")}</span>
            </TabsTrigger>
            <TabsTrigger value="albums" className="gap-1 sm:gap-2 w-32 sm:w-40">
              <Heart className="w-3 h-3 sm:w-4 sm:h-4 flex-shrink-0" />
              <span className="text-xs sm:text-sm leading-tight text-center">{t("albums")}</span>
            </TabsTrigger>
            <TabsTrigger value="artists" className="gap-1 sm:gap-2 w-32 sm:w-40">
              <User className="w-3 h-3 sm:w-4 sm:h-4 flex-shrink-0" />
              <span className="text-xs sm:text-sm leading-tight text-center">{t("artists")}</span>
            </TabsTrigger>
          </TabsList>

          <TabsContent value="playlists" className="mt-0">
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
              {playlists.map((playlist) => (
                <PlaylistCard
                  key={playlist.id}
                  id={playlist.id}
                  title={playlist.title}
                  description={playlist.description}
                />
              ))}
            </div>
          </TabsContent>

          <TabsContent value="albums" className="mt-0">
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
              {albums.map((album) => (
                <PlaylistCard
                  key={album.id}
                  id={album.id}
                  title={album.title}
                  description={album.description}
                />
              ))}
            </div>
          </TabsContent>

          <TabsContent value="artists" className="mt-0">
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
              {artists.map((artist) => (
                <div
                  key={artist.id}
                  className="group relative bg-card p-4 rounded-xl hover:bg-secondary/80 transition-all duration-300 cursor-pointer"
                >
                  <div className="relative mb-4 aspect-square rounded-full overflow-hidden bg-gradient-to-br from-primary/20 to-primary/5" />
                  <h3 className="font-semibold text-foreground mb-1 truncate text-center">
                    {artist.title}
                  </h3>
                  <p className="text-sm text-muted-foreground text-center">{artist.description}</p>
                </div>
              ))}
            </div>
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
};

export default Library;
