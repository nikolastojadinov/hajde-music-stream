import supabase from '../services/supabaseClient';

export type TrackActivityInput = {
  userId: string | null | undefined;
  entityType: string;
  entityId: string;
  context?: unknown;
};

type SerializedContext = string | null;

const normalize = (value: unknown): string => (typeof value === 'string' ? value.trim() : '');

const isValidEntityId = (entityTypeRaw: string, entityIdRaw: string): boolean => {
  const type = normalize(entityTypeRaw).toLowerCase();
  const id = normalize(entityIdRaw);
  if (!type || !id) return false;
  if (type === 'playlist') return id.startsWith('VL') || id.startsWith('PL');
  if (type === 'artist') return id.startsWith('UC');
  if (type === 'album') return id.startsWith('MPRE');
  if (type === 'track' || type === 'song') return id.length === 11;
  return false;
};

function serializeContext(context: unknown): SerializedContext {
  if (context === undefined || context === null) return null;
  if (typeof context === 'string') return context;

  try {
    return JSON.stringify(context);
  } catch (err) {
    console.warn('[trackActivity] context_serialize_failed', { message: err instanceof Error ? err.message : String(err) });
    return null;
  }
}

export async function trackActivity({ userId, entityType, entityId, context }: TrackActivityInput): Promise<void> {
  const userIdValue = normalize(userId);
  const rawTypeValue = normalize(entityType).toLowerCase();
  const entityTypeValue = rawTypeValue === 'song' ? 'track' : rawTypeValue;
  const entityIdValue = normalize(entityId);

  console.log('[trackActivity] ENTER', {
    userId: userIdValue,
    entityType: entityTypeValue,
    entityId: entityIdValue,
    hasSupabase: Boolean(supabase),
  });

  if (!userIdValue) {
    console.log('[trackActivity] SKIP', { reason: 'missing_userId', entityType: entityTypeValue, entityId: entityIdValue });
    return;
  }

  if (!entityTypeValue || !entityIdValue) {
    console.log('[trackActivity] SKIP', {
      reason: 'invalid_payload',
      entityType: entityTypeValue,
      entityId: entityIdValue,
    });
    return;
  }

  if (entityTypeValue.endsWith('_open')) {
    console.log('[trackActivity] SKIP', { reason: 'legacy_open_type', entityType: entityTypeValue, entityId: entityIdValue });
    return;
  }

  if (!isValidEntityId(entityTypeValue, entityIdValue)) {
    console.log('[trackActivity] SKIP', { reason: 'invalid_entity', entityType: entityTypeValue, entityId: entityIdValue });
    return;
  }

  if (!supabase) {
    console.error('[trackActivity] SKIP', { reason: 'missing_supabase_client' });
    return;
  }

  const contextPayload = serializeContext(context);

  console.log('[trackActivity] INSERT ATTEMPT', {
    user_id: userIdValue,
    entity_type: entityTypeValue,
    entity_id: entityIdValue,
    context: contextPayload,
  });

  try {
    const { error } = await supabase.from('user_activity_history').insert({
      user_id: userIdValue,
      entity_type: entityTypeValue,
      entity_id: entityIdValue,
      context: contextPayload,
    });

    if (error) {
      console.error('[trackActivity] INSERT ERROR', {
        code: error.code,
        details: error.details,
        message: error.message,
      });
      return;
    }

    console.log('[trackActivity] INSERT OK');
  } catch (err: any) {
    console.error('[trackActivity] EXCEPTION', {
      message: err?.message || String(err),
    });
  }
}
