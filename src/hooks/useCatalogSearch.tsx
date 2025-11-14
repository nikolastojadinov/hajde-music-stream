import { useState, useEffect, useRef } from 'react';
import { externalSupabase } from '@/lib/externalSupabase';

export interface CatalogPlaylist {
  type: 'playlist';
  id: string;
  title: string;
  track_count: number;
  image_url: string | null;
}

export interface CatalogTrack {
  type: 'track';
  id: string;
  title: string;
  artist: string;
  image_url: string | null;
}

export type CatalogResult = CatalogPlaylist | CatalogTrack;

const RESULTS_PER_PAGE = 12;

// Smart relevance scoring function
function calculateRelevance(item: CatalogResult, searchTerm: string): number {
  const term = searchTerm.toLowerCase().trim();
  let score = 0;
  
  if (item.type === 'playlist') {
    const title = item.title.toLowerCase();
    if (title === term) score += 100; // Exact match
    else if (title.startsWith(term)) score += 50; // Starts with
    else if (title.includes(` ${term}`)) score += 40; // Word boundary
    else if (title.includes(term)) score += 25; // Contains
  } else {
    const title = item.title.toLowerCase();
    const artist = item.artist.toLowerCase();
    
    // Exact matches get highest priority
    if (title === term) score += 100;
    if (artist === term) score += 100;
    
    // Starts with search term
    if (title.startsWith(term)) score += 60;
    if (artist.startsWith(term)) score += 55;
    
    // Word boundary matches
    if (title.includes(` ${term}`)) score += 45;
    if (artist.includes(` ${term}`)) score += 40;
    
    // Contains anywhere
    if (title.includes(term)) score += 30;
    if (artist.includes(term)) score += 25;
  }
  
  return score;
}

export function useCatalogSearch(searchTerm: string) {
  const [results, setResults] = useState<CatalogResult[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const offsetRef = useRef(0);
  const cacheRef = useRef<Map<string, { data: CatalogResult[], timestamp: number }>>(new Map());

  const CACHE_DURATION = 5 * 60 * 1000; // 5 minuta

  const performSearch = async (currentOffset: number, term: string) => {
    const trimmedTerm = term.trim();
    
    if (!trimmedTerm) {
      setResults([]);
      return;
    }

    // Proveri cache za prvi offset
    if (currentOffset === 0) {
      const cached = cacheRef.current.get(trimmedTerm);
      if (cached && Date.now() - cached.timestamp < CACHE_DURATION) {
        console.log('📦 Using cached results for:', trimmedTerm);
        setResults(cached.data);
        setHasMore(cached.data.length === RESULTS_PER_PAGE + 1);
        offsetRef.current = RESULTS_PER_PAGE;
        return;
      }
    }

    console.log('🔍 Loading results, offset:', currentOffset, 'term:', trimmedTerm);
    setIsLoading(true);
    
    try {
      // Search playlists by title
      const { data: playlistsData, error: playlistsError } = await externalSupabase
        .from('playlists')
        .select('id, title, cover_url')
        .ilike('title', `%${trimmedTerm}%`)
        .range(currentOffset, currentOffset + RESULTS_PER_PAGE);

      // Filter out empty playlists (playlists with 0 tracks)
      let filteredPlaylistsData = playlistsData;
      if (playlistsData && playlistsData.length > 0) {
        const { data: playlistsWithTracks } = await externalSupabase
          .from('playlist_tracks')
          .select('playlist_id')
          .in('playlist_id', playlistsData.map(p => p.id));
        
        const validPlaylistIds = new Set(playlistsWithTracks?.map(pt => pt.playlist_id) || []);
        filteredPlaylistsData = playlistsData.filter(p => validPlaylistIds.has(p.id));
      }

      // Search tracks by BOTH title AND artist (smart search)
      const { data: tracksData, error: tracksError } = await externalSupabase
        .from('tracks')
        .select('id, title, artist, cover_url')
        .or(`title.ilike.%${trimmedTerm}%,artist.ilike.%${trimmedTerm}%`)
        .range(currentOffset, currentOffset + RESULTS_PER_PAGE);

      console.log('📦 Got playlists:', filteredPlaylistsData?.length, 'tracks:', tracksData?.length);

      if (playlistsError) {
        console.error('❌ Playlists error:', playlistsError);
        throw playlistsError;
      }

      if (tracksError) {
        console.error('❌ Tracks error:', tracksError);
        throw tracksError;
      }

      const playlists: CatalogPlaylist[] = (filteredPlaylistsData || []).map(playlist => ({
        type: 'playlist' as const,
        id: playlist.id,
        title: playlist.title,
        track_count: 25,
        image_url: playlist.cover_url,
      }));

      const tracks: CatalogTrack[] = (tracksData || []).map(track => ({
        type: 'track' as const,
        id: track.id,
        title: track.title,
        artist: track.artist,
        image_url: track.cover_url,
      }));

      // Combine and sort by relevance (smart ranking)
      const combined = [...playlists, ...tracks].sort((a, b) => 
        calculateRelevance(b, trimmedTerm) - calculateRelevance(a, trimmedTerm)
      );

      console.log('✅ Processed:', playlists.length, 'playlists,', tracks.length, 'tracks, sorted by relevance');
      
      setResults(prev => {
        const newResults = currentOffset === 0 ? combined : [...prev, ...combined];
        console.log('📊 Total results now:', newResults.length);
        
        // Sačuvaj u cache samo za prvi offset
        if (currentOffset === 0) {
          cacheRef.current.set(trimmedTerm, {
            data: newResults,
            timestamp: Date.now()
          });
        }
        
        return newResults;
      });
      
      setHasMore(combined.length === RESULTS_PER_PAGE + 1);
      offsetRef.current = currentOffset + RESULTS_PER_PAGE;
      
    } catch (e) {
      console.error('💥 Exception:', e);
    } finally {
      setIsLoading(false);
    }
  };

  // Reset and search when term changes
  useEffect(() => {
    console.log('🔄 Search term changed:', searchTerm);
    setResults([]);
    offsetRef.current = 0;
    setHasMore(false);
    
    if (searchTerm.trim()) {
      performSearch(0, searchTerm);
    }
  }, [searchTerm]);

  const loadMore = () => {
    console.log('📥 Load more clicked, current offset:', offsetRef.current);
    performSearch(offsetRef.current, searchTerm);
  };

  return { results, isLoading, hasMore, loadMore };
}
