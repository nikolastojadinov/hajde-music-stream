import { recordActivityOnce } from '../services/activityWriter';

export type TrackActivityInput = {
  userId: string | null | undefined;
  entityType: string;
  entityId: string;
  context?: unknown;
};

const normalize = (value: unknown): string => (typeof value === 'string' ? value.trim() : '');

export async function trackActivity({ userId, entityType, entityId, context }: TrackActivityInput): Promise<void> {
  const userIdValue = normalize(userId);
  const entityTypeValue = normalize(entityType).toLowerCase();
  const entityIdValue = normalize(entityId);

  if (!userIdValue || !entityTypeValue || !entityIdValue) {
    console.log('[trackActivity] SKIP', { reason: 'invalid_payload', entityType: entityTypeValue, entityId: entityIdValue });
    return;
  }

  try {
    const status = await recordActivityOnce({
      userId: userIdValue,
      entityType: entityTypeValue,
      entityId: entityIdValue,
      context,
    });

    console.log('[trackActivity] RESULT', { status, entityType: entityTypeValue, entityId: entityIdValue });
  } catch (err: any) {
    console.error('[trackActivity] failed', { message: err?.message || String(err) });
  }
}
