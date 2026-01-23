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

export async function trackActivity({
  userId,
  entityType,
  entityId,
  context,
}: TrackActivityInput): Promise<void> {

  console.log('[trackActivity] ENTER', {
    userId,
    entityType,
    entityId,
    hasSupabase: Boolean(supabase),
  });

  const userIdValue = typeof userId === 'string' ? userId.trim() : '';
  const entityIdValue = typeof entityId === 'string' ? entityId.trim() : '';

  if (!userIdValue || !entityType || !entityIdValue || !supabase) {
    console.log('[trackActivity] EARLY RETURN', {
      userIdValue,
      entityType,
      entityIdValue,
      hasSupabase: Boolean(supabase),
    });
    return;
  }

  const contextPayload = serializeContext(context);

  console.log('[trackActivity] INSERT ATTEMPT', {
    user_id: userIdValue,
    entity_type: entityType,
    entity_id: entityIdValue,
    context: contextPayload,
  });

  try {
    const { error } = await supabase
      .from('user_activity_history')
      .insert({
        user_id: userIdValue,
        entity_type: entityType,
        entity_id: entityIdValue,
        context: contextPayload,
      });

    if (error) {
      console.error('[trackActivity] INSERT ERROR', error);
      return;
    }

    console.log('[trackActivity] INSERT OK');
  } catch (err) {
    console.error('[trackActivity] EXCEPTION', err);
  }
}
