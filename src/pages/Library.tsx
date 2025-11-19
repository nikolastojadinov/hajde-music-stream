import { Heart, ListMusic } from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import PlaylistCard from "@/components/PlaylistCard";
import TrackCard from "@/components/TrackCard";
import { usePi } from "@/contexts/PiContext";
import useLikes from "@/hooks/useLikes";
import { useState } from "react";

const Library = () => {
  const { user } = usePi();
  const { likedTracks, likedPlaylists } = useLikes();
  const userId = user?.uid || null;
  const [activeTab, setActiveTab] = useState<string>("liked-songs");

  return (
    <div className="flex-1 overflow-y-auto pb-32">
      <div className="p-8">
        <h1 className="text-4xl font-bold mb-8 animate-fade-in">Moja Biblioteka</h1>

        <Tabs defaultValue="liked-songs" className="w-full animate-slide-up">
          <TabsList className="bg-secondary mb-8 w-full sm:w-auto">
            <TabsTrigger value="liked-songs" className="gap-1 sm:gap-2 w-40">
              <ListMusic className="w-4 h-4 flex-shrink-0" />
              <span className="text-xs sm:text-sm leading-tight text-center">Omiljene Pesme</span>
            </TabsTrigger>
            <TabsTrigger value="liked-playlists" className="gap-1 sm:gap-2 w-40">
              <Heart className="w-4 h-4 flex-shrink-0" />
              <span className="text-xs sm:text-sm leading-tight text-center">Omiljene Plejliste</span>
            </TabsTrigger>
          </TabsList>

          {/* Liked Songs Tab */}
          <TabsContent value="liked-songs" className="mt-0">
            {!userId ? (
              <div className="text-center py-12 text-muted-foreground">Prijavite se da vidite omiljene pesme.</div>
            ) : likedTracks.length > 0 ? (
              <div className="space-y-1">
                {likedTracks.map((track) => (
                  <TrackCard
                    key={track.id}
                    id={track.id}
                    title={track.title || ''}
                    artist={track.artist || ''}
                    imageUrl={track.cover_url || undefined}
                    youtubeId={track.external_id || ''}
                    duration={track.duration || undefined}
                  />
                ))}
              </div>
            ) : (
              <div className="text-center py-12 text-muted-foreground">
                <ListMusic className="w-16 h-16 mx-auto mb-4 opacity-50" />
                <p>Nema omiljenih pesama.</p>
              </div>
            )}
          </TabsContent>

          {/* Liked Playlists Tab */}
          <TabsContent value="liked-playlists" className="mt-0">
            {!userId ? (
              <div className="text-center py-12 text-muted-foreground">Prijavite se da vidite omiljene plejliste.</div>
            ) : likedPlaylists.length > 0 ? (
              <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
                {likedPlaylists.map((p) => (
                  <PlaylistCard
                    key={p.id}
                    id={p.id}
                    title={p.title || ''}
                    description={p.description || ''}
                    imageUrl={p.cover_url || undefined}
                  />
                ))}
              </div>
            ) : (
              <div className="text-center py-12 text-muted-foreground">
                <Heart className="w-16 h-16 mx-auto mb-4 opacity-50" />
                <p>Nema omiljenih plejlisti.</p>
              </div>
            )}
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
};

export default Library;
