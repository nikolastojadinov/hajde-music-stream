import PlaylistCard from "@/components/PlaylistCard";
import FeaturedForYou from "@/components/home/FeaturedForYou";
import { Search as SearchIcon } from "lucide-react";
import { Input } from "@/components/ui/input";
import { ScrollArea, ScrollBar } from "@/components/ui/scroll-area";
import { useLanguage } from "@/contexts/LanguageContext";
import { usePlaylists } from "@/hooks/usePlaylists";
import { Skeleton } from "@/components/ui/skeleton";
import { useNavigate } from "react-router-dom";

const Home = () => {
  const { t } = useLanguage();
  const navigate = useNavigate();
  
  // Fetch different categories from Supabase (excluding featured - now handled by FeaturedForYou component)
  const { data: recentPlaylists, isLoading: isLoadingRecent } = usePlaylists("recent");
  const { data: popularPlaylists, isLoading: isLoadingPopular } = usePlaylists("popular");
  const { data: moodPlaylists, isLoading: isLoadingMood } = usePlaylists("mood");
  const { data: genrePlaylists, isLoading: isLoadingGenre } = usePlaylists("genre");
  
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
        <div className="mb-6 md:hidden animate-fade-in">
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

        {/* Hero Section */}
        <div className="mb-6 md:mb-8">
          <h1 className="text-3xl md:text-4xl font-bold mb-2 bg-gradient-to-r from-primary via-primary/80 to-primary/60 bg-clip-text text-transparent animate-fade-in">
            {t("welcome_back")}
          </h1>
          <p className="text-muted-foreground animate-fade-in">
            {t("discover_music")}
          </p>
        </div>

        {/* Featured For You Section */}
        <div className="mb-8 md:mb-12 animate-slide-up">
          <FeaturedForYou />
        </div>

        {/* Other Categories with horizontal scroll */}
        {categories.map((category, index) => (
          <section key={index} className="mb-8 md:mb-12 animate-slide-up">
            <h2 className="text-xl md:text-2xl font-bold mb-4 md:mb-6">{category.title}</h2>
            <ScrollArea className="w-full whitespace-nowrap [&>div:first-child]:scrollbar-hide">
              <div className="flex gap-3 md:gap-4 pb-4">
                {category.isLoading ? (
                  // Loading skeletons
                  Array.from({ length: 6 }).map((_, i) => (
                    <div key={i} className="w-[160px] md:w-[180px] flex-shrink-0">
                      <Skeleton className="aspect-square rounded-lg mb-3" />
                      <Skeleton className="h-4 w-3/4 mb-2" />
                      <Skeleton className="h-3 w-full" />
                    </div>
                  ))
                ) : (
                  category.playlists.map((playlist) => (
                    <div key={playlist.id} className="w-[160px] md:w-[180px] flex-shrink-0">
                      <PlaylistCard
                        id={playlist.id}
                        title={playlist.title}
                        description={playlist.description || ""}
                        imageUrl={'image_url' in playlist ? playlist.image_url || undefined : undefined}
                      />
                    </div>
                  ))
                )}
              </div>
            </ScrollArea>
          </section>
        ))}
      </div>
    </div>
  );
};

export default Home;
