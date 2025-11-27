import { useState, useEffect, useMemo } from "react";
import { Search as SearchIcon, Music, ListMusic, User } from "lucide-react";
import { Input } from "@/components/ui/input";
import { useLanguage } from "@/contexts/LanguageContext";
import { useNavigate } from "react-router-dom";
import { usePlayer } from "@/contexts/PlayerContext";
import { externalSupabase } from "@/lib/externalSupabase";

// Types - matching Supabase schema exactly
interface Track {
  id: string;
  external_id: string;
  title: string;
  artist: string;
  cover_url: string | null;
  duration: number | null;
}

interface Playlist {
  id: string;
  title: string;
  cover_url: string | null;
  description: string | null;
}

interface ArtistGroup {
  artist: string;
  tracks: Track[];
}

interface SearchResults {
  tracks: Track[];
  playlists: Playlist[];
  artistGroups: ArtistGroup[];
}

type FilterTab = 'playlists' | 'songs' | 'artists';

const Search = () => {
  const { t } = useLanguage();
  const navigate = useNavigate();
  const { playTrack } = usePlayer();
  
  const [searchTerm, setSearchTerm] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [activeTab, setActiveTab] = useState<FilterTab>('playlists');
  const [results, setResults] = useState<SearchResults>({
    tracks: [],
    playlists: [],
    artistGroups: [],
  });
  const [isLoading, setIsLoading] = useState(false);

  // Debounce 300ms
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(searchTerm.trim());
    }, 300);
    return () => clearTimeout(timer);
  }, [searchTerm]);

  // Reset to default tab when search changes
  useEffect(() => {
    if (searchTerm.length > 0) {
      setActiveTab('playlists');
    }
  }, [searchTerm]);

  // Perform search
  useEffect(() => {
    if (!debouncedSearch) {
      setResults({ tracks: [], playlists: [], artistGroups: [] });
      return;
    }

    const performSearch = async () => {
      setIsLoading(true);
      try {
        const searchPattern = `%${debouncedSearch}%`;

        // Parallel queries with Promise.all
        const [tracksResponse, playlistsResponse, artistTracksResponse] = await Promise.all([
          // Query 1: Tracks matching title or artist
          externalSupabase
            .from('tracks')
            .select('id, external_id, title, artist, cover_url, duration')
            .or(`title.ilike.${searchPattern},artist.ilike.${searchPattern}`)
            .limit(20),

          // Query 2: Playlists matching title
          externalSupabase
            .from('playlists')
            .select('id, title, cover_url, description')
            .ilike('title', searchPattern)
            .limit(20),

          // Query 3: Tracks for artist grouping
          externalSupabase
            .from('tracks')
            .select('id, external_id, title, artist, cover_url, duration')
            .ilike('artist', searchPattern)
            .limit(20),
        ]);

        // Process tracks
        const tracks: Track[] = tracksResponse.data || [];

        // Process playlists - fetch track counts
        const playlistsWithCounts = await Promise.all(
          (playlistsResponse.data || []).map(async (playlist) => {
            const { count } = await externalSupabase
              .from('playlist_tracks')
              .select('*', { count: 'exact', head: true })
              .eq('playlist_id', playlist.id);
            
            return { playlist, count: count || 0 };
          })
        );

        // Filter playlists with item_count > 0
        const playlists: Playlist[] = playlistsWithCounts
          .filter(({ count }) => count > 0)
          .map(({ playlist }) => playlist);

        // Process artist grouping
        const artistMap = new Map<string, Track[]>();
        (artistTracksResponse.data || []).forEach((track: Track) => {
          const existing = artistMap.get(track.artist) || [];
          artistMap.set(track.artist, [...existing, track]);
        });

        const artistGroups: ArtistGroup[] = Array.from(artistMap.entries())
          .map(([artist, tracks]) => ({
            artist,
            tracks: tracks.sort((a, b) => a.title.localeCompare(b.title)),
          }))
          .sort((a, b) => a.artist.localeCompare(b.artist));

        setResults({ tracks, playlists, artistGroups });
      } catch (error) {
        console.error('Search error:', error);
        setResults({ tracks: [], playlists: [], artistGroups: [] });
      } finally {
        setIsLoading(false);
      }
    };

    performSearch();
  }, [debouncedSearch]);

  // IDENTICAL to TrackCard playback - uses playTrack from PlayerContext
  const handleTrackClick = (track: Track) => {
    playTrack(track.external_id, track.title, track.artist, track.id);
  };

  // IDENTICAL to PlaylistCard navigation
  const handlePlaylistClick = (playlistId: string) => {
    navigate(`/playlist/${playlistId}`);
  };

  const formatDuration = (seconds: number | null) => {
    if (!seconds) return "";
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, "0")}`;
  };

  const hasResults = results.tracks.length > 0 || results.playlists.length > 0 || results.artistGroups.length > 0;
  const showEmptyState = debouncedSearch.length > 0 && !isLoading && !hasResults;

  const browseCategories = useMemo(() => [
    { id: 1, title: t("genre_pop"), color: "from-pink-500 to-purple-500" },
    { id: 2, title: t("genre_rock"), color: "from-red-500 to-orange-500" },
    { id: 3, title: t("genre_hiphop"), color: "from-yellow-500 to-green-500" },
    { id: 4, title: t("genre_electronic"), color: "from-blue-500 to-cyan-500" },
    { id: 5, title: t("genre_jazz"), color: "from-indigo-500 to-purple-500" },
    { id: 6, title: t("genre_classical"), color: "from-gray-500 to-slate-500" },
    { id: 7, title: t("genre_rnb"), color: "from-rose-500 to-pink-500" },
    { id: 8, title: t("genre_country"), color: "from-amber-500 to-yellow-500" },
  ], [t]);

  return (
    <div className="flex-1 overflow-y-auto pb-32">
      <div className="p-4 md:p-8">
        {/* Search Input */}
        <div className="mb-6 max-w-2xl animate-fade-in">
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

        {/* Filter Tabs - Show only when searching */}
        {searchTerm.length > 0 && (
          <div className="mb-8 max-w-2xl flex gap-3 animate-fade-in">
            <button
              onClick={() => setActiveTab('playlists')}
              className={`px-6 py-2.5 rounded-full font-medium transition-all duration-200 ${
                activeTab === 'playlists'
                  ? 'border-2 border-yellow-500 text-yellow-500 bg-yellow-500/10'
                  : 'border-2 border-yellow-600/40 text-yellow-600/70 hover:border-yellow-500/60 hover:text-yellow-500/90'
              }`}
            >
              <span className="flex items-center gap-2">
                <ListMusic className="w-4 h-4" />
                Playlists
              </span>
            </button>
            
            <button
              onClick={() => setActiveTab('songs')}
              className={`px-6 py-2.5 rounded-full font-medium transition-all duration-200 ${
                activeTab === 'songs'
                  ? 'border-2 border-yellow-500 text-yellow-500 bg-yellow-500/10'
                  : 'border-2 border-yellow-600/40 text-yellow-600/70 hover:border-yellow-500/60 hover:text-yellow-500/90'
              }`}
            >
              <span className="flex items-center gap-2">
                <Music className="w-4 h-4" />
                Songs
              </span>
            </button>
            
            <button
              onClick={() => setActiveTab('artists')}
              className={`px-6 py-2.5 rounded-full font-medium transition-all duration-200 ${
                activeTab === 'artists'
                  ? 'border-2 border-yellow-500 text-yellow-500 bg-yellow-500/10'
                  : 'border-2 border-yellow-600/40 text-yellow-600/70 hover:border-yellow-500/60 hover:text-yellow-500/90'
              }`}
            >
              <span className="flex items-center gap-2">
                <User className="w-4 h-4" />
                Artists
              </span>
            </button>
          </div>
        )}

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
                  {t("search_no_results").replace("{query}", debouncedSearch)}
                </p>
                <p className="text-muted-foreground text-sm mt-2">
                  {t("search_try_different")}
                </p>
              </div>
            ) : hasResults ? (
              <div className="space-y-10 animate-fade-in">
                {/* PLAYLISTS Tab */}
                {activeTab === 'playlists' && results.playlists.length > 0 && (
                  <section>
                    <div className="flex items-center gap-2 mb-4">
                      <ListMusic className="w-6 h-6 text-primary" />
                      <h2 className="text-2xl font-bold text-foreground">
                        {`${t("search_section_playlists")} (${results.playlists.length})`}
                      </h2>
                    </div>

                    {/* Mobile: Vertical list */}
                    <div className="md:hidden space-y-2">
                      {results.playlists.map((playlist) => (
                        <div
                          key={playlist.id}
                          onClick={() => handlePlaylistClick(playlist.id)}
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
                            {playlist.description && (
                              <p className="text-xs text-muted-foreground line-clamp-1">
                                {playlist.description}
                              </p>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>

                    {/* Desktop: Grid layout */}
                    <div className="hidden md:grid md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6 gap-4">
                      {results.playlists.map((playlist) => (
                        <div
                          key={playlist.id}
                          onClick={() => handlePlaylistClick(playlist.id)}
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
                          {playlist.description && (
                            <p className="text-xs text-muted-foreground line-clamp-2">
                              {playlist.description}
                            </p>
                          )}
                        </div>
                      ))}
                    </div>
                  </section>
                )}

                {/* SONGS Tab */}
                {activeTab === 'songs' && results.tracks.length > 0 && (
                  <section>
                    <div className="flex items-center gap-2 mb-4">
                      <Music className="w-6 h-6 text-primary" />
                      <h2 className="text-2xl font-bold text-foreground">
                        {`${t("search_section_songs")} (${results.tracks.length})`}
                      </h2>
                    </div>

                    {/* Mobile: Vertical list */}
                    <div className="md:hidden space-y-2">
                      {results.tracks.map((track) => (
                        <div
                          key={track.id}
                          onClick={() => handleTrackClick(track)}
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
                          {track.duration && (
                            <div className="text-xs text-muted-foreground flex-shrink-0">
                              {formatDuration(track.duration)}
                            </div>
                          )}
                        </div>
                      ))}
                    </div>

                    {/* Desktop: Grid layout */}
                    <div className="hidden md:grid md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6 gap-4">
                      {results.tracks.map((track) => (
                        <div
                          key={track.id}
                          onClick={() => handleTrackClick(track)}
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

                {/* ARTISTS Tab */}
                {activeTab === 'artists' && results.artistGroups.length > 0 && (
                  <section>
                    <div className="flex items-center gap-2 mb-4">
                      <User className="w-6 h-6 text-primary" />
                      <h2 className="text-2xl font-bold text-foreground">
                        {`${t("search_section_artists")} (${results.artistGroups.length})`}
                      </h2>
                    </div>

                    <div className="space-y-6">
                      {results.artistGroups.map((group) => (
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
                                onClick={() => handleTrackClick(track)}
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
                                {track.duration && (
                                  <div className="text-xs text-muted-foreground flex-shrink-0">
                                    {formatDuration(track.duration)}
                                  </div>
                                )}
                              </div>
                            ))}
                          </div>

                          {/* Desktop: Grid layout of tracks */}
                          <div className="hidden md:grid md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6 gap-4">
                            {group.tracks.map((track) => (
                              <div
                                key={track.id}
                                onClick={() => handleTrackClick(track)}
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
