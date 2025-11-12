import { useState, useEffect } from "react";
import { Search as SearchIcon } from "lucide-react";
import { Input } from "@/components/ui/input";
import PlaylistCard from "@/components/PlaylistCard";
import TrackCard from "@/components/TrackCard";
import { useLanguage } from "@/contexts/LanguageContext";
import { useSearch } from "@/hooks/useSearch";
import { Skeleton } from "@/components/ui/skeleton";

const Search = () => {
  const { t } = useLanguage();
  const [searchTerm, setSearchTerm] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");

  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(searchTerm);
    }, 300);
    return () => clearTimeout(timer);
  }, [searchTerm]);

  const { data: searchResults, isLoading } = useSearch(debouncedSearch);

  const hasResults = searchResults && (searchResults.tracks.length > 0 || searchResults.playlists.length > 0);
  const showEmptyState = debouncedSearch.length > 0 && !isLoading && !hasResults;

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
      <div className="p-4 md:p-8">
        <div className="mb-8 max-w-2xl animate-fade-in">
          <div className="relative">
            <SearchIcon className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-muted-foreground" />
            <Input
              type="text"
              placeholder={t("search_placeholder")}
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="pl-12 h-12 bg-card border-border text-foreground placeholder:text-muted-foreground"
              autoFocus
            />
          </div>
        </div>

        {/* Search Results */}
        {debouncedSearch.length > 0 && (
          <div className="mb-12">
            {isLoading ? (
              <div className="space-y-8">
                <div>
                  <Skeleton className="h-8 w-32 mb-4" />
                  <div className="space-y-2">
                    {[1, 2, 3, 4].map((i) => (
                      <Skeleton key={i} className="h-20 w-full" />
                    ))}
                  </div>
                </div>
                <div>
                  <Skeleton className="h-8 w-32 mb-4" />
                  <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6 gap-4">
                    {[1, 2, 3, 4].map((i) => (
                      <div key={i}>
                        <Skeleton className="aspect-square rounded-lg mb-2" />
                        <Skeleton className="h-4 w-3/4 mb-2" />
                        <Skeleton className="h-3 w-full" />
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            ) : showEmptyState ? (
              <div className="text-center py-12">
                <p className="text-muted-foreground text-lg">
                  Nema rezultata za "{debouncedSearch}"
                </p>
                <p className="text-muted-foreground text-sm mt-2">
                  Pokušajte sa drugim ključnim rečima
                </p>
              </div>
            ) : hasResults ? (
              <div className="space-y-8 animate-fade-in">
                {/* Tracks Results */}
                {searchResults.tracks.length > 0 && (
                  <section>
                    <h2 className="text-2xl font-bold mb-4">
                      Pesme ({searchResults.tracks.length})
                    </h2>
                    <div className="space-y-1">
                      {searchResults.tracks.map((track) => (
                        <TrackCard
                          key={track.id}
                          id={track.id}
                          title={track.title}
                          artist={track.artist}
                          imageUrl={track.image_url}
                          youtubeId={track.youtube_id}
                          duration={track.duration}
                        />
                      ))}
                    </div>
                  </section>
                )}

                {/* Playlists Results */}
                {searchResults.playlists.length > 0 && (
                  <section>
                    <h2 className="text-2xl font-bold mb-4">
                      Plejliste ({searchResults.playlists.length})
                    </h2>
                    <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6 gap-4">
                      {searchResults.playlists.map((playlist) => (
                        <PlaylistCard
                          key={playlist.id}
                          id={playlist.id}
                          title={playlist.title}
                          description={playlist.description || ""}
                          imageUrl={playlist.image_url || undefined}
                        />
                      ))}
                    </div>
                  </section>
                )}
              </div>
            ) : null}
          </div>
        )}

        {/* Show categories only when not searching */}
        {debouncedSearch.length === 0 && (
          <>
            <section className="animate-slide-up mb-12">
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
          </>
        )}
      </div>
    </div>
  );
};

export default Search;
