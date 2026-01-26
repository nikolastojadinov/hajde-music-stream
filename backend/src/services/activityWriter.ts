import { writeActivity } from './localSearchService';

type SnapshotMeta = {
  title: string;
  subtitle?: string | null;
  imageUrl?: string | null;
};

const isValidEntityId = (entityTypeRaw: string, entityIdRaw: string): boolean => {
  const type = (entityTypeRaw || '').trim().toLowerCase();
  const id = (entityIdRaw || '').trim();
  if (!type || !id) return false;

  if (type === 'playlist') return id.startsWith('VL') || id.startsWith('PL');
  if (type === 'artist') return id.startsWith('UC');
  if (type === 'album') return id.startsWith('MPRE');
  if (type === 'track' || type === 'song') return id.length === 11; // YouTube video id length

  return false;
};

export async function recordActivityOnce(params: {
  userId: string;
  entityType: string;
  entityId: string;
  context?: unknown;
  snapshot?: SnapshotMeta | null;
}): Promise<'inserted' | 'skipped_duplicate' | 'skipped_invalid_entity'> {
  if (!isValidEntityId(params.entityType, params.entityId)) {
    return 'skipped_invalid_entity';
  }

  const contextPayload = (() => {
    if (params.context !== undefined) return params.context;
    if (params.snapshot) return { snapshot: params.snapshot };
    return undefined;
  })();

  return writeActivity({
    userId: params.userId,
    entityType: params.entityType,
    entityId: params.entityId,
    context: contextPayload,
  });
}
