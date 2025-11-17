import { useState, useEffect } from "react";
import { Search as SearchIcon, Music, ListMusic, User } from "lucide-react";
import { Input } from "@/components/ui/input";
import { useLanguage } from "@/contexts/LanguageContext";
import { useNavigate } from "react-router-dom";
import { usePlayer } from "@/contexts/PlayerContext";
import { externalSupabase } from "@/lib/externalSupabase";

// Types
interface Track {
  id: string;
  external_id: string;
  title: string;
  artist: string;
  cover_url: string | null;
}

interface Playlist {
  id: string;
  external_id: string;
  title: string;
  cover_url: string | null;
  item_count: number;
}

interface ArtistGroup {
  artist: string;
  tracks: Track[];
}

interface SearchResults {
  tracks: Track[];
  playlists: Playlist[];
  artists: ArtistGroup[];
}

const Search = () => {
  const { t } = useLanguage();
  const navigate = useNavigate();
  const { playTrack } = usePlayer();
  
  const [searchTerm, setSearchTerm] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [results, setResults] = useState<SearchResults>({
    tracks: [],
    playlists: [],
    artists: [],
  });
  const [isLoading, setIsLoading] = useState(false);

  // Debounce search input
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(searchTerm.trim());
    }, 300);
    return () => clearTimeout(timer);
  }, [searchTerm]);

  // Perform search when debounced term changes
  useEffect(() => {
    if (!debouncedSearch) {
      setResults({ tracks: [], playlists: [], artists: [] });
      return;
    }

    const fetchResults = async () => {
      setIsLoading(true);
      try {
        const pattern = `%${debouncedSearch}%`;

        // Run all queries in parallel
        const [tracksRes, playlistsRes, artistTracksRes] = await Promise.all([
          // Query 1: Tracks matching title or artist
          externalSupabase
            .from('tracks')
            .select('id, external_id, title, artist, cover_url')
            .or(`title.ilike.${pattern},artist.ilike.${pattern}`)
            .limit(20),

          // Query 2: Playlists matching title or description
          externalSupabase
            .from('playlists')
            .select('id, external_id, title, cover_url')
            .ilike('title', pattern)
            .limit(20),

          // Query 3: Tracks for artist-based grouping
          externalSupabase
            .from('tracks')
            .select('id, external_id, title, artist, cover_url')
            .ilike('artist', pattern)
            .limit(20),
        ]);

        // Process tracks
        const tracks: Track[] = (tracksRes.data || []).filter(
          (track) => track.title.toLowerCase().includes(debouncedSearch.toLowerCase())
        );

        // Process playlists - count tracks for each playlist
        const playlistsWithCounts = await Promise.all(
          (playlistsRes.data || []).map(async (playlist) => {
            const { count } = await externalSupabase
              .from('playlist_tracks')
              .select('*', { count: 'exact', head: true })
              .eq('playlist_id', playlist.id);

            return {
              ...playlist,
              item_count: count || 0,
            };
          })
        );

        const playlists: Playlist[] = playlistsWithCounts.filter(
          (playlist) => playlist.item_count > 0
        );

        // Process artist grouping
        const artistMap = new Map<string, Track[]>();
        (artistTracksRes.data || []).forEach((track) => {
          if (track.artist.toLowerCase().includes(debouncedSearch.toLowerCase())) {
            const existing = artistMap.get(track.artist) || [];
            artistMap.set(track.artist, [...existing, track]);
          }
        });

        const artists: ArtistGroup[] = Array.from(artistMap.entries())
          .map(([artist, tracks]) => ({
            artist,
            tracks: tracks.sort((a, b) => a.title.localeCompare(b.title)),
          }))
          .sort((a, b) => a.artist.localeCompare(b.artist));

        setResults({ tracks, playlists, artists });
      } catch (error) {
        console.error('Search error:', error);
        setResults({ tracks: [], playlists: [], artists: [] });
      } finally {
        setIsLoading(false);
      }
    };

    fetchResults();
  }, [debouncedSearch]);

  const hasResults = results.tracks.length > 0 || results.playlists.length > 0 || results.artists.length > 0;
  const showEmptyState = debouncedSearch.length > 0 && !isLoading && !hasResults;

  const browseCategories = [
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
        {/* Search Input */}
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
                <div className="animate-pulse">
                  <div className="h-8 w-48 bg-muted rounded mb-4"></div>
                  <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6 gap-4">
                    {[1, 2, 3, 4, 5, 6].map((i) => (
                      <div key={i}>
                        <div className="aspect-square bg-muted rounded-lg mb-2"></div>
                        <div className="h-4 w-3/4 bg-muted rounded mb-2"></div>
                        <div className="h-3 w-full bg-muted rounded"></div>
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
              <div className="space-y-10 animate-fade-in">
                {/* SONGS Section */}
                {results.tracks.length > 0 && (
                  <section>
                    <div className="flex items-center gap-2 mb-4">
                      <Music className="w-6 h-6 text-primary" />
                      <h2 className="text-2xl font-bold text-foreground">
                        Pesme ({results.tracks.length})
                      </h2>
                    </div>

                    {/* Mobile: Vertical list */}
                    <div className="md:hidden space-y-2">
                      {results.tracks.map((track) => (
                        <div
                          key={track.id}
                          onClick={() => playTrack(track.external_id, track.title, track.artist)}
                          className="flex items-center gap-3 p-2 rounded-lg hover:bg-white/5 active:bg-white/10 transition-colors cursor-pointer"
                        >
                          <div className="w-16 h-16 rounded-md bg-card flex-shrink-0 overflow-hidden">
                            {track.cover_url ? (
                              <img
                                src={track.cover_url}
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
                            <h3 className="font-medium text-sm line-clamp-1 mb-1 text-foreground">
                              {track.title}
                            </h3>
                            <p className="text-xs text-muted-foreground">{track.artist}</p>
                          </div>
                        </div>
                      ))}
                    </div>

                    {/* Desktop: Grid layout */}
                    <div className="hidden md:grid md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6 gap-4">
                      {results.tracks.map((track) => (
                        <div
                          key={track.id}
                          onClick={() => playTrack(track.external_id, track.title, track.artist)}
                          className="cursor-pointer group"
                        >
                          <div className="aspect-square bg-card rounded-lg mb-3 overflow-hidden transition-transform group-hover:scale-105">
                            {track.cover_url ? (
                              <img
                                src={track.cover_url}
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
                          <h3 className="font-medium line-clamp-2 text-sm mb-1 text-foreground">
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
                {results.playlists.length > 0 && (
                  <section>
                    <div className="flex items-center gap-2 mb-4">
                      <ListMusic className="w-6 h-6 text-primary" />
                      <h2 className="text-2xl font-bold text-foreground">
                        Plejliste ({results.playlists.length})
                      </h2>
                    </div>

                    {/* Mobile: Vertical list */}
                    <div className="md:hidden space-y-2">
                      {results.playlists.map((playlist) => (
                        <div
                          key={playlist.id}
                          onClick={() => navigate(`/playlist/${playlist.id}`)}
                          className="flex items-center gap-3 p-2 rounded-lg hover:bg-white/5 active:bg-white/10 transition-colors cursor-pointer"
                        >
                          <div className="w-16 h-16 rounded-md bg-card flex-shrink-0 overflow-hidden">
                            {playlist.cover_url ? (
                              <img
                                src={playlist.cover_url}
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
                            <h3 className="font-medium text-sm line-clamp-1 mb-1 text-foreground">
                              {playlist.title}
                            </h3>
                            <p className="text-xs text-muted-foreground">
                              {playlist.item_count} pesama
                            </p>
                          </div>
                        </div>
                      ))}
                    </div>

                    {/* Desktop: Grid layout */}
                    <div className="hidden md:grid md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6 gap-4">
                      {results.playlists.map((playlist) => (
                        <div
                          key={playlist.id}
                          onClick={() => navigate(`/playlist/${playlist.id}`)}
                          className="cursor-pointer group"
                        >
                          <div className="aspect-square bg-card rounded-lg mb-3 overflow-hidden transition-transform group-hover:scale-105">
                            {playlist.cover_url ? (
                              <img
                                src={playlist.cover_url}
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
                          <h3 className="font-medium line-clamp-2 text-sm mb-1 text-foreground">
                            {playlist.title}
                          </h3>
                          <p className="text-xs text-muted-foreground">
                            {playlist.item_count} pesama
                          </p>
                        </div>
                      ))}
                    </div>
                  </section>
                )}

                {/* ARTISTS Section */}
                {results.artists.length > 0 && (
                  <section>
                    <div className="flex items-center gap-2 mb-4">
                      <User className="w-6 h-6 text-primary" />
                      <h2 className="text-2xl font-bold text-foreground">
                        Izvođači ({results.artists.length})
                      </h2>
                    </div>

                    <div className="space-y-6">
                      {results.artists.map((group) => (
                        <div key={group.artist} className="space-y-3">
                          {/* Artist name - NOT CLICKABLE */}
                          <h3 className="text-lg font-semibold text-muted-foreground px-2">
                            {group.artist}
                          </h3>

                          {/* Mobile: Vertical list of tracks */}
                          <div className="md:hidden space-y-2">
                            {group.tracks.map((track) => (
                              <div
                                key={track.id}
                                onClick={() => playTrack(track.external_id, track.title, track.artist)}
                                className="flex items-center gap-3 p-2 rounded-lg hover:bg-white/5 active:bg-white/10 transition-colors cursor-pointer"
                              >
                                <div className="w-12 h-12 rounded-md bg-card flex-shrink-0 overflow-hidden">
                                  {track.cover_url ? (
                                    <img
                                      src={track.cover_url}
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
                                  <h4 className="font-medium text-sm line-clamp-1 text-foreground">
                                    {track.title}
                                  </h4>
                                </div>
                              </div>
                            ))}
                          </div>

                          {/* Desktop: Grid layout of tracks */}
                          <div className="hidden md:grid md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6 gap-4">
                            {group.tracks.map((track) => (
                              <div
                                key={track.id}
                                onClick={() => playTrack(track.external_id, track.title, track.artist)}
                                className="cursor-pointer group"
                              >
                                <div className="aspect-square bg-card rounded-lg mb-3 overflow-hidden transition-transform group-hover:scale-105">
                                  {track.cover_url ? (
                                    <img
                                      src={track.cover_url}
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
                                <h4 className="font-medium line-clamp-2 text-sm text-foreground">
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

        {/* Browse by Genre - Show when no search */}
        {!debouncedSearch && (
          <div className="animate-fade-in">
            <h2 className="text-2xl font-bold mb-6 text-foreground">{t("browse_all")}</h2>
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
              {browseCategories.map((category) => (
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
