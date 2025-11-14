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
      
      if (!term) {
        setResults([]);
        return;
      }

      setIsLoading(true);
      
      try {
        // Search playlists in the external database
        const { data, error } = await externalSupabase
          .from('playlists')
          .select('id, title')
          .ilike('title', `%${term}%`)
          .limit(100);

        if (error) throw error;

        // Count tracks for each playlist
        const playlistsWithCounts = await Promise.all(
          (data || []).map(async (playlist) => {
            const { count } = await externalSupabase
              .from('tracks')
              .select('*', { count: 'exact', head: true })
              .eq('playlist_id', playlist.id);

            return {
              id: playlist.id,
              title: playlist.title,
              track_count: count || 0,
            };
          })
        );

        // Filter playlists with more than 20 tracks
        const filtered = playlistsWithCounts.filter(p => p.track_count > 20);

        setResults(filtered);
      } catch (e) {
        console.error('Search error:', e);
        setResults([]);
      } finally {
        setIsLoading(false);
      }
    };

    search();
  }, [searchTerm]);

  return { results, isLoading };
}
