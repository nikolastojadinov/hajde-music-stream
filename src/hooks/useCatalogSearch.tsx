import { useState, useEffect } from 'react';

export interface CatalogPlaylist {
  id: string;
  title: string;
  track_count: number;
}

// Load the full catalog from the CSV file
let fullCatalog: CatalogPlaylist[] = [];

async function loadCatalog(): Promise<CatalogPlaylist[]> {
  if (fullCatalog.length > 0) return fullCatalog;

  try {
    // Parse the CSV data (we'll embed it as a constant for now)
    const response = await fetch('/playlist-catalog.json');
    if (response.ok) {
      const data = await response.json();
      fullCatalog = data || [];
      return fullCatalog;
    }
  } catch (e) {
    console.error('Failed to load playlist catalog:', e);
  }

  // Fallback to empty array if loading fails
  return [];
}

export function useCatalogSearch(searchTerm: string) {
  const [results, setResults] = useState<CatalogPlaylist[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    const search = async () => {
      const term = searchTerm.trim().toLowerCase();
      
      if (!term) {
        setResults([]);
        return;
      }

      setIsLoading(true);
      
      try {
        const catalog = await loadCatalog();
        
        // Filter playlists that match the search term
        const filtered = (catalog || []).filter(playlist =>
          playlist.title.toLowerCase().includes(term)
        );

        // Sort by relevance (exact matches first, then by track count)
        filtered.sort((a, b) => {
          const aExact = a.title.toLowerCase() === term ? 1 : 0;
          const bExact = b.title.toLowerCase() === term ? 1 : 0;
          
          if (aExact !== bExact) return bExact - aExact;
          return b.track_count - a.track_count;
        });

        setResults(filtered.slice(0, 100)); // Limit to 100 results
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
