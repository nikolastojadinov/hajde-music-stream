import { useState, useEffect } from "react";
import { Search as SearchIcon, Music, ListMusic, User } from "lucide-react";
import { Input } from "@/components/ui/input";
import { useLanguage } from "@/contexts/LanguageContext";
import { useNewSearch, SearchTrack, SearchPlaylist } from "@/hooks/useNewSearch";
import { Skeleton } from "@/components/ui/skeleton";
import { useNavigate } from "react-router-dom";
import { usePlayer } from "@/contexts/PlayerContext";

const Search = () => {
  const { t } = useLanguage();
  const navigate = useNavigate();
  const { playTrack } = usePlayer();
  const [searchTerm, setSearchTerm] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");

  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(searchTerm);
    }, 250);
    return () => clearTimeout(timer);
  }, [searchTerm]);

  const { data, isLoading } = useNewSearch(debouncedSearch);
  const { songs = [], playlists = [], artistGroups = [] } = data || {};

  const hasResults = songs.length > 0 || playlists.length > 0 || artistGroups.length > 0;
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
                {[1, 2, 3].map((section) => (
                  <div key={section}>
                    <Skeleton className="h-8 w-48 mb-4" />
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
                ))}
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
              <div className="space-y-10 animate-fade-in">
                {/* SONGS Section */}
                {songs.length > 0 && (
                  <section>
                    <div className="flex items-center gap-2 mb-4">
                      <Music className="w-6 h-6 text-primary" />
                      <h2 className="text-2xl font-bold">
                        Pesme ({songs.length})
                      </h2>
                    </div>
                    
                    {/* Mobile: Vertical list */}
                    <div className="md:hidden space-y-2">
                      {songs.map((track: SearchTrack) => (
                        <div
                          key={track.id}
                          onClick={() => playTrack(track.youtube_id, track.title, track.artist)}
                          className="flex items-center gap-3 p-2 rounded-lg hover:bg-white/5 active:bg-white/10 transition-colors cursor-pointer"
                        >
                          <div className="w-16 h-16 rounded-md bg-card flex-shrink-0 overflow-hidden">
                            {track.cover_url || track.image_url ? (
                              <img 
                                src={track.cover_url || track.image_url || "/placeholder.svg"} 
                                alt={track.title}
                                className="w-full h-full object-cover"
                                onError={(e) => {
                                  (e.target as HTMLImageElement).src = "/placeholder.svg";
                                }}
                              />
                            ) : (
                              <div className="w-full h-full bg-gradient-to-br from-primary/20 to-primary/5 flex items-center justify-center">
                                <Music className="w-6 h-6 text-primary/50" />
                              </div>
                            )}
                          </div>
                          <div className="flex-1 min-w-0">
                            <h3 className="font-medium text-sm line-clamp-1 mb-1">
                              {track.title}
                            </h3>
                            <p className="text-xs text-muted-foreground">
                              {track.artist}
                            </p>
                          </div>
                        </div>
                      ))}
                    </div>

                    {/* Desktop: Grid layout */}
                    <div className="hidden md:grid md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6 gap-4">
                      {songs.map((track: SearchTrack) => (
                        <div 
                          key={track.id}
                          onClick={() => playTrack(track.youtube_id, track.title, track.artist)}
                          className="cursor-pointer group"
                        >
                          <div className="aspect-square bg-card rounded-lg mb-3 overflow-hidden transition-transform group-hover:scale-105">
                            {track.cover_url || track.image_url ? (
                              <img 
                                src={track.cover_url || track.image_url || "/placeholder.svg"} 
                                alt={track.title}
                                className="w-full h-full object-cover"
                                onError={(e) => {
                                  (e.target as HTMLImageElement).src = "/placeholder.svg";
                                }}
                              />
                            ) : (
                              <div className="w-full h-full bg-gradient-to-br from-primary/20 to-primary/5 flex items-center justify-center">
                                <Music className="w-8 h-8 text-primary/50" />
                              </div>
                            )}
                          </div>
                          <h3 className="font-medium line-clamp-2 text-sm mb-1">
                            {track.title}
                          </h3>
                          <p className="text-xs text-muted-foreground line-clamp-1">
                            {track.artist}
                          </p>
                        </div>
                      ))}
                    </div>
                  </section>
                )}

                {/* PLAYLISTS Section */}
                {playlists.length > 0 && (
                  <section>
                    <div className="flex items-center gap-2 mb-4">
                      <ListMusic className="w-6 h-6 text-primary" />
                      <h2 className="text-2xl font-bold">
                        Plejliste ({playlists.length})
                      </h2>
                    </div>
                    
                    {/* Mobile: Vertical list */}
                    <div className="md:hidden space-y-2">
                      {playlists.map((playlist: SearchPlaylist) => (
                        <div
                          key={playlist.id}
                          onClick={() => navigate(`/playlist/${playlist.id}`)}
                          className="flex items-center gap-3 p-2 rounded-lg hover:bg-white/5 active:bg-white/10 transition-colors cursor-pointer"
                        >
                          <div className="w-16 h-16 rounded-md bg-card flex-shrink-0 overflow-hidden">
                            {playlist.cover_url || playlist.image_url ? (
                              <img 
                                src={playlist.cover_url || playlist.image_url || "/placeholder.svg"} 
                                alt={playlist.title}
                                className="w-full h-full object-cover"
                                onError={(e) => {
                                  (e.target as HTMLImageElement).src = "/placeholder.svg";
                                }}
                              />
                            ) : (
                              <div className="w-full h-full bg-gradient-to-br from-primary/20 to-primary/5 flex items-center justify-center">
                                <ListMusic className="w-6 h-6 text-primary/50" />
                              </div>
                            )}
                          </div>
                          <div className="flex-1 min-w-0">
                            <h3 className="font-medium text-sm line-clamp-1 mb-1">
                              {playlist.title}
                            </h3>
                            <p className="text-xs text-muted-foreground">
                              {playlist.track_count} pesama
                            </p>
                          </div>
                        </div>
                      ))}
                    </div>

                    {/* Desktop: Grid layout */}
                    <div className="hidden md:grid md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6 gap-4">
                      {playlists.map((playlist: SearchPlaylist) => (
                        <div 
                          key={playlist.id}
                          onClick={() => navigate(`/playlist/${playlist.id}`)}
                          className="cursor-pointer group"
                        >
                          <div className="aspect-square bg-card rounded-lg mb-3 overflow-hidden transition-transform group-hover:scale-105">
                            {playlist.cover_url || playlist.image_url ? (
                              <img 
                                src={playlist.cover_url || playlist.image_url || "/placeholder.svg"} 
                                alt={playlist.title}
                                className="w-full h-full object-cover"
                                onError={(e) => {
                                  (e.target as HTMLImageElement).src = "/placeholder.svg";
                                }}
                              />
                            ) : (
                              <div className="w-full h-full bg-gradient-to-br from-primary/20 to-primary/5 flex items-center justify-center">
                                <ListMusic className="w-8 h-8 text-primary/50" />
                              </div>
                            )}
                          </div>
                          <h3 className="font-medium line-clamp-2 text-sm mb-1">
                            {playlist.title}
                          </h3>
                          <p className="text-xs text-muted-foreground">
                            {playlist.track_count} pesama
                          </p>
                        </div>
                      ))}
                    </div>
                  </section>
                )}

                {/* ARTISTS Section */}
                {artistGroups.length > 0 && (
                  <section>
                    <div className="flex items-center gap-2 mb-4">
                      <User className="w-6 h-6 text-primary" />
                      <h2 className="text-2xl font-bold">
                        Izvođači ({artistGroups.length})
                      </h2>
                    </div>
                    
                    <div className="space-y-6">
                      {artistGroups.map((group) => (
                        <div key={group.artist} className="space-y-3">
                          {/* Artist name - NOT CLICKABLE */}
                          <h3 className="text-lg font-semibold text-muted-foreground px-2">
                            {group.artist}
                          </h3>
                          
                          {/* Mobile: Vertical list of tracks */}
                          <div className="md:hidden space-y-2">
                            {group.tracks.map((track: SearchTrack) => (
                              <div
                                key={track.id}
                                onClick={() => playTrack(track.youtube_id, track.title, track.artist)}
                                className="flex items-center gap-3 p-2 rounded-lg hover:bg-white/5 active:bg-white/10 transition-colors cursor-pointer"
                              >
                                <div className="w-12 h-12 rounded-md bg-card flex-shrink-0 overflow-hidden">
                                  {track.cover_url || track.image_url ? (
                                    <img 
                                      src={track.cover_url || track.image_url || "/placeholder.svg"} 
                                      alt={track.title}
                                      className="w-full h-full object-cover"
                                      onError={(e) => {
                                        (e.target as HTMLImageElement).src = "/placeholder.svg";
                                      }}
                                    />
                                  ) : (
                                    <div className="w-full h-full bg-gradient-to-br from-primary/20 to-primary/5 flex items-center justify-center">
                                      <Music className="w-4 h-4 text-primary/50" />
                                    </div>
                                  )}
                                </div>
                                <div className="flex-1 min-w-0">
                                  <h4 className="font-medium text-sm line-clamp-1">
                                    {track.title}
                                  </h4>
                                </div>
                              </div>
                            ))}
                          </div>

                          {/* Desktop: Grid layout of tracks */}
                          <div className="hidden md:grid md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6 gap-4">
                            {group.tracks.map((track: SearchTrack) => (
                              <div 
                                key={track.id}
                                onClick={() => playTrack(track.youtube_id, track.title, track.artist)}
                                className="cursor-pointer group"
                              >
                                <div className="aspect-square bg-card rounded-lg mb-3 overflow-hidden transition-transform group-hover:scale-105">
                                  {track.cover_url || track.image_url ? (
                                    <img 
                                      src={track.cover_url || track.image_url || "/placeholder.svg"} 
                                      alt={track.title}
                                      className="w-full h-full object-cover"
                                      onError={(e) => {
                                        (e.target as HTMLImageElement).src = "/placeholder.svg";
                                      }}
                                    />
                                  ) : (
                                    <div className="w-full h-full bg-gradient-to-br from-primary/20 to-primary/5 flex items-center justify-center">
                                      <Music className="w-8 h-8 text-primary/50" />
                                    </div>
                                  )}
                                </div>
                                <h4 className="font-medium line-clamp-2 text-sm">
                                  {track.title}
                                </h4>
                              </div>
                            ))}
                          </div>
                        </div>
                      ))}
                    </div>
                  </section>
                )}
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
                    <h3 className="text-foreground text-xl font-bold text-center">
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
