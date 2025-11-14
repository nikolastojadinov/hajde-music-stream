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
      // Pretraga playlista
      const { data: playlistsData, error: playlistsError } = await externalSupabase
        .from('playlists')
        .select('id, title, cover_url')
        .ilike('title', `%${trimmedTerm}%`)
        .range(currentOffset, currentOffset + RESULTS_PER_PAGE);

      // Pretraga pesama
      const { data: tracksData, error: tracksError } = await externalSupabase
        .from('tracks')
        .select('id, title, artist, cover_url')
        .ilike('title', `%${trimmedTerm}%`)
        .range(currentOffset, currentOffset + RESULTS_PER_PAGE);

      console.log('📦 Got playlists:', playlistsData?.length, 'tracks:', tracksData?.length);

      if (playlistsError) {
        console.error('❌ Playlists error:', playlistsError);
        throw playlistsError;
      }

      if (tracksError) {
        console.error('❌ Tracks error:', tracksError);
        throw tracksError;
      }

      const playlists: CatalogPlaylist[] = (playlistsData || []).map(playlist => ({
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

      const combined = [...playlists, ...tracks];

      console.log('✅ Processed:', playlists.length, 'playlists,', tracks.length, 'tracks');
      
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
