import supabase from '../services/supabaseClient';

export type ActivityEntityType = 'search' | 'artist' | 'album' | 'playlist';

export type TrackActivityInput = {
  userId: string | null | undefined;
  entityType: ActivityEntityType;
  entityId: string;
  context?: unknown;
};

function serializeContext(context: unknown): string | null {
  if (context === undefined || context === null) return null;
  if (typeof context === 'string') return context;

  try {
    return JSON.stringify(context);
  } catch {
    return null;
  }
}

export async function trackActivity({ userId, entityType, entityId, context }: TrackActivityInput): Promise<void> {
  const userIdValue = typeof userId === 'string' ? userId.trim() : '';
  const entityIdValue = typeof entityId === 'string' ? entityId.trim() : '';

  if (!userIdValue || !entityType || !entityIdValue) return;

  const contextPayload = serializeContext(context);

  try {
    const { error } = await supabase.from('user_activity_history').insert({
      user_id: userIdValue,
      entity_type: entityType,
      entity_id: entityIdValue,
      context: contextPayload,
    });

    if (error) {
      console.error('[activityTracker] failed to record activity', {
        userId: userIdValue,
        entityType,
        entityId: entityIdValue,
        message: error.message,
      });
    }
  } catch (err) {
    console.error('[activityTracker] unexpected error', {
      userId: userIdValue,
      entityType,
      entityId: entityIdValue,
      message: err instanceof Error ? err.message : String(err),
    });
  }
}
