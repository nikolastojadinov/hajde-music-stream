import { useEffect, useState } from 'react';
import eruda from 'eruda';

export function ErudaDevTools() {
  const [isInitialized, setIsInitialized] = useState(false);

  useEffect(() => {
    if (!isInitialized) {
      // Initialize Eruda
      eruda.init();
      setIsInitialized(true);
      console.log('🚀 Eruda Dev Tools initialized');
    }

    return () => {
      // Cleanup on unmount
      if (isInitialized) {
        eruda.destroy();
      }
    };
  }, [isInitialized]);

  return null; // Eruda creates its own UI
}
