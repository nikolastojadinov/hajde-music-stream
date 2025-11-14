import { useState, useEffect } from "react";
import { Search as SearchIcon } from "lucide-react";
import { Input } from "@/components/ui/input";
import { useLanguage } from "@/contexts/LanguageContext";
import { useCatalogSearch, CatalogResult } from "@/hooks/useCatalogSearch";
import { Skeleton } from "@/components/ui/skeleton";
import { useNavigate } from "react-router-dom";

const Search = () => {
  const { t } = useLanguage();
  const navigate = useNavigate();
  const [searchTerm, setSearchTerm] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");

  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(searchTerm);
    }, 300);
    return () => clearTimeout(timer);
  }, [searchTerm]);

  const { results: catalogResults, isLoading, hasMore, loadMore } = useCatalogSearch(debouncedSearch);

  const hasResults = catalogResults.length > 0;
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
              <div className="space-y-4">
                <Skeleton className="h-8 w-48 mb-4" />
                <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6 gap-4">
                  {[1, 2, 3, 4, 5, 6].map((i) => (
                    <div key={i}>
                      <Skeleton className="aspect-square rounded-lg mb-2" />
                      <Skeleton className="h-4 w-3/4 mb-2" />
                      <Skeleton className="h-3 w-full" />
                    </div>
                  ))}
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
              <div className="space-y-6 animate-fade-in">
                <section>
                  <h2 className="text-2xl font-bold mb-4">
                    Pronađene plejliste ({catalogResults.length})
                  </h2>
                  
                  {/* Mobile: Vertical list with images */}
                  <div className="md:hidden space-y-2">
                    {catalogResults.map((result: CatalogResult) => (
                      <div
                        key={result.id}
                        onClick={() => result.type === 'playlist' ? navigate(`/playlist/${result.id}`) : null}
                        className="flex items-center gap-3 p-2 rounded-lg hover:bg-white/5 active:bg-white/10 transition-colors cursor-pointer"
                      >
                        <div className="w-16 h-16 rounded-md bg-card flex-shrink-0 overflow-hidden">
                          {result.image_url ? (
                            <img 
                              src={result.image_url} 
                              alt={result.title}
                              className="w-full h-full object-cover"
                              onError={(e) => {
                                (e.target as HTMLImageElement).src = "/placeholder.svg";
                              }}
                            />
                          ) : (
                            <div className="w-full h-full bg-gradient-to-br from-primary/20 to-primary/5 flex items-center justify-center">
                              <div className="text-center px-2">
                                <p className="text-xs font-semibold text-foreground line-clamp-2">
                                  {result.title}
                                </p>
                              </div>
                            </div>
                          )}
                        </div>
                        <div className="flex-1 min-w-0">
                          <h3 className="font-medium text-sm line-clamp-1 mb-1">
                            {result.title}
                          </h3>
                          <p className="text-xs text-muted-foreground">
                            {result.type === 'playlist' 
                              ? `Plejlista • ${result.track_count} pesama`
                              : `Pesma • ${result.artist}`
                            }
                          </p>
                        </div>
                      </div>
                    ))}
                  </div>

                  {/* Desktop: Grid layout */}
                  <div className="hidden md:grid md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6 gap-4">
                    {catalogResults.map((result: CatalogResult) => (
                      <div 
                        key={result.id}
                        onClick={() => result.type === 'playlist' ? navigate(`/playlist/${result.id}`) : null}
                        className="cursor-pointer group"
                      >
                        <div className="aspect-square bg-card rounded-lg mb-3 overflow-hidden transition-transform group-hover:scale-105">
                          {result.image_url ? (
                            <img 
                              src={result.image_url} 
                              alt={result.title}
                              className="w-full h-full object-cover"
                              onError={(e) => {
                                (e.target as HTMLImageElement).src = "/placeholder.svg";
                              }}
                            />
                          ) : (
                            <div className="w-full h-full bg-gradient-to-br from-primary/20 to-primary/5 flex items-center justify-center">
                              <div className="text-center p-4">
                                <p className="font-semibold text-foreground line-clamp-2 mb-2">
                                  {result.title}
                                </p>
                                <p className="text-xs text-muted-foreground">
                                  {result.type === 'playlist' ? `${result.track_count} pesama` : result.artist}
                                </p>
                              </div>
                            </div>
                          )}
                        </div>
                        <h3 className="font-medium line-clamp-2 text-sm mb-1">
                          {result.title}
                        </h3>
                        <p className="text-xs text-muted-foreground">
                          {result.type === 'playlist' ? `${result.track_count} tracks` : result.artist}
                        </p>
                      </div>
                    ))}
                  </div>
                  
                  {/* Load More Button */}
                  {hasMore && !isLoading && (
                    <div className="flex justify-center mt-8">
                      <button
                        onClick={loadMore}
                        className="px-6 py-3 bg-card hover:bg-card/80 text-foreground rounded-lg transition-colors border border-border"
                      >
                        more...
                      </button>
                    </div>
                  )}
                  
                  {/* Loading indicator for "Load More" */}
                  {isLoading && catalogResults.length > 0 && (
                    <div className="flex justify-center mt-8">
                      <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
                    </div>
                  )}
                </section>
              </div>
            ) : null}
          </div>
        )}

        {/* Browse by Genre */}
        {!debouncedSearch && (
          <div className="animate-fade-in">
            <h2 className="text-2xl font-bold mb-6">{t("browse_all")}</h2>
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
              {categories.map((category) => (
                <div
                  key={category.id}
                  className="relative h-32 rounded-lg overflow-hidden cursor-pointer group hover:scale-105 transition-transform"
                >
                  <div
                    className={`absolute inset-0 bg-gradient-to-br ${category.color} opacity-80 group-hover:opacity-100 transition-opacity`}
                  />
                  <div className="relative h-full flex items-center justify-center p-4">
                    <h3 className="text-white text-xl font-bold text-center">
                      {category.title}
                    </h3>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default Search;
