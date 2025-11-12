import { Search as SearchIcon } from "lucide-react";
import { Input } from "@/components/ui/input";
import PlaylistCard from "@/components/PlaylistCard";
import { useLanguage } from "@/contexts/LanguageContext";

const Search = () => {
  const { t } = useLanguage();
  const categories = [
    { id: 1, title: "Pop", color: "from-pink-500 to-purple-500" },
    { id: 2, title: "Rock", color: "from-red-500 to-orange-500" },
    { id: 3, title: "Hip-Hop", color: "from-yellow-500 to-green-500" },
    { id: 4, title: "Electronic", color: "from-blue-500 to-cyan-500" },
    { id: 5, title: "Jazz", color: "from-indigo-500 to-purple-500" },
    { id: 6, title: "Classical", color: "from-gray-500 to-slate-500" },
    { id: 7, title: "R&B", color: "from-rose-500 to-pink-500" },
    { id: 8, title: "Country", color: "from-amber-500 to-yellow-500" },
  ];

  return (
    <div className="flex-1 overflow-y-auto pb-32">
      <div className="p-8">
        <div className="mb-8 max-w-md animate-fade-in">
          <div className="relative">
            <SearchIcon className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-muted-foreground" />
            <Input
              type="text"
              placeholder={t("search_placeholder")}
              className="pl-12 h-12 bg-card border-border text-foreground placeholder:text-muted-foreground"
            />
          </div>
        </div>

        <section className="animate-slide-up">
          <h2 className="text-2xl font-bold mb-6">{t("search_genre")}</h2>
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
            {categories.map((category) => (
              <div
                key={category.id}
                className="relative h-40 rounded-xl overflow-hidden cursor-pointer group"
              >
                <div className={`absolute inset-0 bg-gradient-to-br ${category.color} group-hover:scale-105 transition-transform duration-300`} />
                <div className="relative h-full p-4 flex items-end">
                  <h3 className="text-2xl font-bold text-white">{category.title}</h3>
                </div>
              </div>
            ))}
          </div>
        </section>

        <section className="mt-12 animate-slide-up">
          <h2 className="text-2xl font-bold mb-6">{t("popular")}</h2>
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6 gap-4">
            {[1, 2, 3, 4, 5, 6].map((i) => (
              <PlaylistCard
                key={i}
                id={i}
                title={`${t("popular_playlist")} ${i}`}
                description={t("most_popular_songs")}
              />
            ))}
          </div>
        </section>
      </div>
    </div>
  );
};

export default Search;
