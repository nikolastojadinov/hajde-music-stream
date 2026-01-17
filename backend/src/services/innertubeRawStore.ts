import supabase from './supabaseClient';

export type InnertubeRequestType = 'search' | 'playlist' | 'artist' | 'album' | 'browse' | 'suggest';

const enableRawPayloads = (process.env.ENABLE_RAW_PAYLOADS || 'false').toLowerCase() === 'true';

export function shouldRecordInnertubePayload(requestType: InnertubeRequestType): boolean {
  if (!enableRawPayloads) return false;
  if (requestType === 'suggest') return false;
  return true;
}

function safePayload(payload: any): any {
  if (payload === undefined) return null;
  return payload;
}

export async function recordInnertubePayload(requestType: InnertubeRequestType, requestKey: string | null, payload: any): Promise<void> {
  if (!shouldRecordInnertubePayload(requestType)) return;

  if (!supabase) {
    console.warn('[innertubeRawStore] supabase not configured; skipping payload persist');
    return;
  }

  try {
    const row = {
      request_type: requestType,
      request_key: requestKey,
      source: 'innertube',
      endpoint: requestType,
      query: requestKey,
      payload: safePayload(payload),
      status: 'pending',
    } as Record<string, any>;

    const { error } = await supabase.from('innertube_raw_payloads').insert(row);

    if (error) {
      console.error('[innertubeRawStore] failed to insert payload', { requestType, requestKey, error: error.message });
    }
  } catch (err: any) {
    console.error('[innertubeRawStore] unexpected error', { requestType, requestKey, message: err?.message });
  }
}
