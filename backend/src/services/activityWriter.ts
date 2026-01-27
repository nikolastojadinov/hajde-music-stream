import { writeActivity } from './localSearchService';

type SnapshotMeta = {
  title: string;
  subtitle?: string | null;
  imageUrl?: string | null;
};

const normalize = (value: unknown): string => (typeof value === 'string' ? value.trim() : '');

const isValidEntityId = (entityTypeRaw: string, entityIdRaw: string): boolean => {
  const type = normalize(entityTypeRaw).toLowerCase();
  const id = normalize(entityIdRaw);
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
  const entityType = normalize(params.entityType).toLowerCase();
  const entityId = normalize(params.entityId);
  const normalizedType = entityType === 'song' ? 'track' : entityType;

  if (!isValidEntityId(normalizedType, entityId)) {
    return 'skipped_invalid_entity';
  }

  const contextPayload = (() => {
    if (params.context !== undefined) return params.context;
    if (params.snapshot) return { snapshot: params.snapshot };
    return undefined;
  })();

  return writeActivity({
    userId: normalize(params.userId),
    entityType: normalizedType,
    entityId,
    context: contextPayload,
  });
}
