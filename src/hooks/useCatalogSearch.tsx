import { useState, useEffect } from 'react';
import { externalSupabase } from '@/lib/externalSupabase';

export interface CatalogPlaylist {
  id: string;
  title: string;
  track_count: number;
}

export function useCatalogSearch(searchTerm: string) {
  const [results, setResults] = useState<CatalogPlaylist[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    const search = async () => {
      const term = searchTerm.trim();
      
      console.log('🔍 Search started with term:', term);
      
      if (!term) {
        setResults([]);
        return;
      }

      setIsLoading(true);
      
      try {
        console.log('📡 Calling external Supabase...');
        
        // Search playlists in the external database
        const { data, error } = await externalSupabase
          .from('playlists')
          .select('id, title')
          .ilike('title', `%${term}%`)
          .limit(50);

        console.log('📦 Search response:', { data, error });

        if (error) {
          console.error('❌ Search error:', error);
          throw error;
        }

        // Return results with placeholder track count
        const playlists = (data || []).map(playlist => ({
          id: playlist.id,
          title: playlist.title,
          track_count: 25, // Placeholder, we'll load actual count on click
        }));

        console.log('✅ Found playlists:', playlists.length);
        setResults(playlists);
      } catch (e) {
        console.error('💥 Search exception:', e);
        setResults([]);
      } finally {
        setIsLoading(false);
      }
    };

    search();
  }, [searchTerm]);

  return { results, isLoading };
}
