import { useState, useEffect, useRef } from 'react';
import { externalSupabase } from '@/lib/externalSupabase';

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

  const performSearch = async (currentOffset: number, term: string) => {
    const trimmedTerm = term.trim();
    
    if (!trimmedTerm) {
      setResults([]);
      return;
    }

    console.log('🔍 Loading results, offset:', currentOffset, 'term:', trimmedTerm);
    setIsLoading(true);
    
    try {
      const { data, error } = await externalSupabase
        .from('playlists')
        .select('id, title, image_url')
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
        image_url: playlist.image_url,
      }));

      console.log('✅ Processed:', playlists.length, 'playlists');
      
      setResults(prev => {
        const newResults = currentOffset === 0 ? playlists : [...prev, ...playlists];
        console.log('📊 Total results now:', newResults.length);
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
