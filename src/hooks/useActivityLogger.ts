import { useRef } from 'react';

import { postLocalActivity } from '@/lib/api/localSearch';

const isValidEntityId = (entityTypeRaw: string, entityIdRaw: string): boolean => {
  const type = (entityTypeRaw || '').trim().toLowerCase();
  const id = (entityIdRaw || '').trim();
  if (!type || !id) return false;
  if (type === 'playlist') return id.startsWith('VL') || id.startsWith('PL');
  if (type === 'artist') return id.startsWith('UC');
  if (type === 'album') return id.startsWith('MPRE');
  if (type === 'track' || type === 'song') return id.length === 11;
  return false;
};

const DEDUPE_WINDOW_MS = 1200;

export function useActivityLogger() {
  const lastRef = useRef<{ key: string; ts: number } | null>(null);

  const logActivity = async (entityType: string, entityId: string, context?: unknown) => {
    if (!isValidEntityId(entityType, entityId)) return 'skipped_invalid_entity' as const;
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
