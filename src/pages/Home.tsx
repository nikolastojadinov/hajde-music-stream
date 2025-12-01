import PlaylistCard from "@/components/PlaylistCard";
import FeaturedForYou from "@/components/home/FeaturedForYou";
import JumpBackGrid from "@/components/home/JumpBackGrid";
import TopSongsSection from "@/components/home/TopSongsSection";
import { Search as SearchIcon } from "lucide-react";
import { Input } from "@/components/ui/input";
import { ScrollArea, ScrollBar } from "@/components/ui/scroll-area";
import { useLanguage } from "@/contexts/LanguageContext";
import { usePlaylists } from "@/hooks/usePlaylists";
import { Skeleton } from "@/components/ui/skeleton";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

const BEST_OF_RNB_PLAYLIST_IDS = [
  "PLDIoUOhQQPlVFjmZnM41bOzoowjfTS4wU",
  "PLdjynnbWVGDkjusKFwqnRb4p7pCn9ZujU",
  "PLrZoX_h4DFIvZeenXGhLFXaarIo0ii68d",
  "PL1puyG1gnPbpmncMC36a6RLm-NSz_Rs18",
  "PL08ytyBKu7cp10v7cIdGkwLGk6sb_Vcw-",
  "PLQFaxYyYuinoLi3hvLt4bc8V6yjluTKFd",
  "PLSmGb1TO3MjTTrI0bMZksM9gbSkwO0wCt",
  "PL0kNWD0XZExeHWo5PUDC1GFdtY8Mpvnyt",
] as const;

const Home = () => {
  const { t } = useLanguage();
  const navigate = useNavigate();
  
  // Fetch different categories from Supabase
  const { data: recentPlaylists, isLoading: isLoadingRecent } = usePlaylists("recent");
  const { data: popularPlaylists, isLoading: isLoadingPopular } = usePlaylists("popular");
  const { data: moodPlaylists, isLoading: isLoadingMood } = usePlaylists("mood");
  const { data: genrePlaylists, isLoading: isLoadingGenre } = usePlaylists("genre");
  
  const { data: bestOfRnBPlaylists = [], isLoading: isLoadingBestOfRnB, error: bestOfRnBError } = useQuery({
    queryKey: ["best-of-rnb-playlists"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("playlists")
        .select("id, title, cover_url, external_id")
        .in("external_id", [...BEST_OF_RNB_PLAYLIST_IDS])
        .order("title", { ascending: true });

      if (error) throw error;
      return data ?? [];
    },
  });

  const categories = [
    {
      title: t("recently_played"),
      playlists: recentPlaylists || [],
      isLoading: isLoadingRecent,
    },
    {
      title: t("popular_now"),
      playlists: popularPlaylists || [],
      isLoading: isLoadingPopular,
    },
    {
      title: t("by_mood"),
      playlists: moodPlaylists || [],
      isLoading: isLoadingMood,
    },
    {
      title: t("by_genre"),
      playlists: genrePlaylists || [],
      isLoading: isLoadingGenre,
    },
  ];

  return (
    <div className="flex-1 overflow-y-auto scrollbar-hide">
      <div className="p-4 md:p-8 pb-8">
        {/* Mobile Search Bar */}
        <div className="mb-4 md:hidden animate-fade-in">
          <div className="relative">
            <SearchIcon className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-muted-foreground" />
            <Input
              type="text"
              placeholder={t("search_placeholder")}
              className="pl-12 h-12 bg-card border-border text-foreground placeholder:text-muted-foreground"
              onFocus={() => navigate("/search")}
            />
          </div>
        </div>

        {/* Jump Back In - Personalized Recent Playlists (2x3 Grid) - NO HEADING */}
        <div className="mb-6 animate-slide-up">
          <JumpBackGrid />
        </div>

        {/* Featured For You Section */}
        <div className="mb-8 md:mb-12 animate-slide-up">
          <FeaturedForYou />
        </div>

        <TopSongsSection />

        <section className="mb-8 md:mb-12 animate-slide-up">
          <h2 className="text-2xl font-bold text-foreground px-4 md:px-8">
            Best of R&B
          </h2>
          <div className="px-4 md:px-8">
            {bestOfRnBError ? (
              <div className="text-foreground/60 py-8">
                Error loading playlists. Please try again later.
              </div>
            ) : (
              <ScrollArea className="w-full whitespace-nowrap rounded-md">
                <div className="flex w-max space-x-4 pb-4">
                  {isLoadingBestOfRnB ? (
                    Array.from({ length: 8 }).map((_, index) => (
                      <div key={index} className="w-[140px] space-y-2">
                        <Skeleton className="h-[140px] w-[140px] rounded-md" />
                        <div className="space-y-1">
                          <Skeleton className="h-3 w-24" />
                          <Skeleton className="h-3 w-20" />
                        </div>
                      </div>
                    ))
                  ) : bestOfRnBPlaylists.length > 0 ? (
                    bestOfRnBPlaylists.map((playlist) => (
                      <div key={playlist.id} className="w-[140px]">
                        <PlaylistCard
                          id={playlist.id}
                          title={playlist.title ?? ""}
                          description=""
                          imageUrl={playlist.cover_url || "/placeholder.svg"}
                        />
                      </div>
                    ))
                  ) : (
                    <div className="text-foreground/60 py-8">
                      No playlists found. Please check the Supabase data.
                    </div>
                  )}
                </div>
                <ScrollBar orientation="horizontal" />
              </ScrollArea>
            )}
          </div>
        </section>

        {/* Other Categories with horizontal scroll */}
        {categories.map((category, index) => (
          <section key={index} className="mb-8 md:mb-12 animate-slide-up">
            <h2 className="text-xl md:text-2xl font-bold mb-4 md:mb-6">{category.title}</h2>
            <ScrollArea className="w-full whitespace-nowrap [&>div:first-child]:scrollbar-hide">
              <div className="flex gap-3 md:gap-4 pb-4">
                {category.isLoading ? (
                  // Loading skeletons
                  Array.from({ length: 6 }).map((_, i) => (
                    <div key={i} className="w-[130px] md:w-[140px] flex-shrink-0">
                      <Skeleton className="aspect-square rounded-md mb-2" />
                      <Skeleton className="h-3 w-3/4 mb-1" />
                      <Skeleton className="h-3 w-full" />
                    </div>
                  ))
                ) : (
                  category.playlists.map((playlist) => (
                    <div key={playlist.id} className="w-[130px] md:w-[140px] flex-shrink-0">
                      <PlaylistCard
                        id={playlist.id}
                        title={playlist.title}
                        description={playlist.description || ""}
                        imageUrl={playlist.cover_url || "/placeholder.svg"}
                      />
                    </div>
                  ))
                )}
              </div>
              <ScrollBar orientation="horizontal" />
            </ScrollArea>
          </section>
        ))}
      </div>
    </div>
  );
};

export default Home;
