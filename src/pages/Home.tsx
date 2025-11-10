import PlaylistCard from "@/components/PlaylistCard";
import { Search as SearchIcon } from "lucide-react";
import { Input } from "@/components/ui/input";
import { ScrollArea, ScrollBar } from "@/components/ui/scroll-area";
import { useLanguage } from "@/contexts/LanguageContext";

const Home = () => {
  const { t } = useLanguage();
  
  const categories = [
    {
      title: t("featured_for_you"),
      playlists: [
        { id: 1, title: "Top Hits 2024", description: "Najpopularnije pesme trenutno" },
        { id: 2, title: "Chill Vibes", description: "Opuštajuća muzika za svaki trenutak" },
        { id: 3, title: "Workout Energy", description: "Motivacija za trening" },
        { id: 4, title: "Deep Focus", description: "Muzika za koncentraciju" },
        { id: 5, title: "Party Mix", description: "Zabavna muzika za žurke" },
        { id: 6, title: "Rock Classics", description: "Besmrtne rok pesme" },
        { id: 7, title: "Jazz Evening", description: "Smooth jazz melodije" },
        { id: 8, title: "Pop Stars", description: "Najveći pop hitovi" },
      ],
    },
    {
      title: t("recently_played"),
      playlists: [
        { id: 9, title: "Moja Plejlista #1", description: "50 pesama" },
        { id: 10, title: "Road Trip", description: "Muzika za putovanje" },
        { id: 11, title: "Summer Hits", description: "Ljetni hitovi" },
        { id: 12, title: "Evening Jazz", description: "Opuštajući jazz" },
        { id: 13, title: "Morning Coffee", description: "Jutarnja inspiracija" },
        { id: 14, title: "Night Drive", description: "Noćna vožnja" },
        { id: 15, title: "Study Session", description: "Fokus i koncentracija" },
        { id: 16, title: "Dance Party", description: "Plesna zabava" },
      ],
    },
    {
      title: t("popular_now"),
      playlists: [
        { id: 17, title: "Trending Now", description: "Najslušanije pesme" },
        { id: 18, title: "Viral Hits", description: "Viralni hitovi" },
        { id: 19, title: "New Releases", description: "Nova muzika" },
        { id: 20, title: "Charts Global", description: "Svetske top liste" },
        { id: 21, title: "Rising Stars", description: "Nove zvezde" },
        { id: 22, title: "Hot 100", description: "Top 100 pesama" },
        { id: 23, title: "Club Bangers", description: "Klubske pesme" },
        { id: 24, title: "Radio Hits", description: "Radio hitovi" },
      ],
    },
    {
      title: t("by_mood"),
      playlists: [
        { id: 25, title: "Happy Vibes", description: "Vesela atmosfera" },
        { id: 26, title: "Sad Songs", description: "Emotivne pesme" },
        { id: 27, title: "Energetic", description: "Puna energija" },
        { id: 28, title: "Relaxing", description: "Relaksacija" },
        { id: 29, title: "Romantic", description: "Romantične melodije" },
        { id: 30, title: "Motivational", description: "Motivaciona muzika" },
        { id: 31, title: "Melancholic", description: "Melanholične pesme" },
        { id: 32, title: "Uplifting", description: "Podizanje raspoloženja" },
      ],
    },
    {
      title: t("by_genre"),
      playlists: [
        { id: 33, title: "Hip Hop Essentials", description: "Najbolji hip hop" },
        { id: 34, title: "Electronic Beats", description: "Elektronska muzika" },
        { id: 35, title: "Country Roads", description: "Kantri hitovi" },
        { id: 36, title: "Classical Masters", description: "Klasična muzika" },
        { id: 37, title: "Blues & Soul", description: "Blues i soul" },
        { id: 38, title: "Latin Rhythms", description: "Latino ritmovi" },
        { id: 39, title: "Metal Power", description: "Heavy metal" },
        { id: 40, title: "Indie Vibes", description: "Indie muzika" },
      ],
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

        {/* Categories with horizontal scroll */}
        {categories.map((category, index) => (
          <section key={index} className="mb-8 md:mb-12 animate-slide-up">
            <h2 className="text-xl md:text-2xl font-bold mb-4 md:mb-6">{category.title}</h2>
            <ScrollArea className="w-full whitespace-nowrap [&>div:first-child]:scrollbar-hide">
              <div className="flex gap-3 md:gap-4 pb-4">
                {category.playlists.map((playlist) => (
                  <div key={playlist.id} className="w-[160px] md:w-[180px] flex-shrink-0">
                    <PlaylistCard
                      id={playlist.id}
                      title={playlist.title}
                      description={playlist.description}
                    />
                  </div>
                ))}
              </div>
            </ScrollArea>
          </section>
        ))}
      </div>
    </div>
  );
};

export default Home;
