import { useRef } from 'react';

import { postLocalActivity } from '@/lib/api/localSearch';

const DEDUPE_WINDOW_MS = 1200;

export function useActivityLogger() {
  const lastRef = useRef<{ key: string; ts: number } | null>(null);

  const logActivity = async (entityType: string, entityId: string, context?: unknown) => {
    const key = `${entityType}::${entityId}`;
    const now = Date.now();
    if (lastRef.current && lastRef.current.key === key && now - lastRef.current.ts < DEDUPE_WINDOW_MS) {
      return 'skipped_duplicate' as const;
    }
    lastRef.current = { key, ts: now };
    try {
      return await postLocalActivity({ entityType, entityId, context });
    } catch {
      return 'error' as const;
    }
  };

  return { logActivity };
}
