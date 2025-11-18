import { Music, Heart, ListMusic } from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import PlaylistCard from "@/components/PlaylistCard";
import TrackCard from "@/components/TrackCard";
import { useLanguage } from "@/contexts/LanguageContext";
import { useLikes } from "@/hooks/useLikes";
import { usePi } from "@/contexts/PiContext";
import { externalSupabase } from "@/lib/externalSupabase";
import { useState, useEffect } from "react";

interface UserPlaylist {
  id: string;
  title: string;
  description: string | null;
  cover_url: string | null;
}

const Library = () => {
  const { t } = useLanguage();
  const { user, loading } = usePi();
  const { likedPlaylists, likedTracks, loading: likesLoading } = useLikes();
  const [myPlaylists, setMyPlaylists] = useState<UserPlaylist[]>([]);
  const [loadingMyPlaylists, setLoadingMyPlaylists] = useState(false);

  // Load user's own playlists
  useEffect(() => {
    const loadMyPlaylists = async () => {
      if (!user?.uid) {
        setMyPlaylists([]);
        return;
      }

      try {
        setLoadingMyPlaylists(true);
        const { data, error } = await externalSupabase
          .from("playlists")
          .select("id, title, description, cover_url")
          .eq("owner_id", user.uid)
          .order("created_at", { ascending: false });

        if (error) {
          console.error("❌ Error loading my playlists:", error);
          return;
        }

        setMyPlaylists(data || []);
      } catch (error) {
        console.error("❌ Exception loading my playlists:", error);
      } finally {
        setLoadingMyPlaylists(false);
      }
    };

    loadMyPlaylists();
  }, [user?.uid]);

  return (
    <div className="flex-1 overflow-y-auto pb-32">
      <div className="p-8">
        <h1 className="text-4xl font-bold mb-8 animate-fade-in">{t("your_library")}</h1>

        <Tabs defaultValue="my-playlists" className="w-full animate-slide-up">
          <TabsList className="bg-secondary mb-8 w-full sm:w-auto">
            <TabsTrigger value="my-playlists" className="gap-1 sm:gap-2 w-32 sm:w-40">
              <Music className="w-3 h-3 sm:w-4 sm:h-4 flex-shrink-0" />
              <span className="text-xs sm:text-sm leading-tight text-center">{t("my_playlists")}</span>
            </TabsTrigger>
            <TabsTrigger value="liked-playlists" className="gap-1 sm:gap-2 w-32 sm:w-40">
              <Heart className="w-3 h-3 sm:w-4 sm:h-4 flex-shrink-0" />
              <span className="text-xs sm:text-sm leading-tight text-center">{t("liked_playlists")}</span>
            </TabsTrigger>
            <TabsTrigger value="liked-songs" className="gap-1 sm:gap-2 w-32 sm:w-40">
              <ListMusic className="w-3 h-3 sm:w-4 sm:h-4 flex-shrink-0" />
              <span className="text-xs sm:text-sm leading-tight text-center">{t("liked_songs")}</span>
            </TabsTrigger>
          </TabsList>

          {/* My Playlists Tab */}
          <TabsContent value="my-playlists" className="mt-0">
            {loading || loadingMyPlaylists ? (
              <div className="text-center py-12 text-muted-foreground">
                {t("loading")}...
              </div>
            ) : myPlaylists.length > 0 ? (
              <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
                {myPlaylists.map((playlist) => (
                  <PlaylistCard
                    key={playlist.id}
                    id={playlist.id}
                    title={playlist.title}
                    description={playlist.description || ""}
                    imageUrl={playlist.cover_url || undefined}
                  />
                ))}
              </div>
            ) : (
              <div className="text-center py-12 text-muted-foreground">
                <Music className="w-16 h-16 mx-auto mb-4 opacity-50" />
                <p>{t("no_playlists_created")}</p>
                <p className="text-sm mt-2">{t("create_first_playlist")}</p>
              </div>
            )}
          </TabsContent>

          {/* Liked Playlists Tab */}
          <TabsContent value="liked-playlists" className="mt-0">
            {loading || likesLoading ? (
              <div className="text-center py-12 text-muted-foreground">
                {t("loading")}...
              </div>
            ) : likedPlaylists.length > 0 ? (
              <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
                {likedPlaylists.map((playlist) => (
                  <PlaylistCard
                    key={playlist.id}
                    id={playlist.id}
                    title={playlist.title}
                    description={playlist.description || ""}
                    imageUrl={playlist.cover_url || undefined}
                  />
                ))}
              </div>
            ) : (
              <div className="text-center py-12 text-muted-foreground">
                <Heart className="w-16 h-16 mx-auto mb-4 opacity-50" />
                <p>{t("no_liked_playlists")}</p>
                <p className="text-sm mt-2">{t("like_playlists_to_see_here")}</p>
              </div>
            )}
          </TabsContent>

          {/* Liked Songs Tab */}
          <TabsContent value="liked-songs" className="mt-0">
            {loading || likesLoading ? (
              <div className="text-center py-12 text-muted-foreground">
                {t("loading")}...
              </div>
            ) : likedTracks.length > 0 ? (
              <div className="space-y-1">
                {likedTracks.map((track) => (
                  <TrackCard
                    key={track.id}
                    id={track.id}
                    title={track.title}
                    artist={track.artist}
                    imageUrl={track.cover_url || track.image_url}
                    youtubeId={track.external_id || track.youtube_id}
                    duration={track.duration}
                  />
                ))}
              </div>
            ) : (
              <div className="text-center py-12 text-muted-foreground">
                <ListMusic className="w-16 h-16 mx-auto mb-4 opacity-50" />
                <p>{t("no_liked_songs")}</p>
                <p className="text-sm mt-2">{t("like_songs_to_see_here")}</p>
              </div>
            )}
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
};

export default Library;
