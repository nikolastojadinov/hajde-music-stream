import { useState, useEffect, useRef } from 'react';
import { supabase } from '@/integrations/supabase/client';

export interface CatalogPlaylist {
  id: string;
  title: string;
  track_count: number;
  image_url: string | null;
}

const RESULTS_PER_PAGE = 12;

export function useCatalogSearch(searchTerm: string) {
  const [results, setResults] = useState<CatalogPlaylist[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const offsetRef = useRef(0);
  const cacheRef = useRef<Map<string, { data: CatalogPlaylist[], timestamp: number }>>(new Map());

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
      const { data, error } = await supabase
        .from('playlists')
        .select('id, title, cover_url, image_url')
        .ilike('title', `%${trimmedTerm}%`)
        .range(currentOffset, currentOffset + RESULTS_PER_PAGE);

      console.log('📦 Got data:', data?.length, 'items');

      if (error) {
        console.error('❌ Error:', error);
        throw error;
      }

      const playlists = (data || []).map(playlist => ({
        id: playlist.id,
        title: playlist.title,
        track_count: 25,
        image_url: playlist.cover_url || playlist.image_url,
      }));

      console.log('✅ Processed:', playlists.length, 'playlists');
      
      setResults(prev => {
        const newResults = currentOffset === 0 ? playlists : [...prev, ...playlists];
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
      
      setHasMore(playlists.length === RESULTS_PER_PAGE + 1);
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
