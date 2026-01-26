import { writeActivity } from './localSearchService';

export async function recordActivityOnce(params: { userId: string; entityType: string; entityId: string; context?: unknown }): Promise<'inserted' | 'skipped_duplicate'> {
  return writeActivity(params);
}
