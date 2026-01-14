import supabase from './supabaseClient';

export type InnertubeRequestType = 'search' | 'playlist' | 'artist' | 'album' | 'browse' | 'suggest';

function safePayload(payload: any): any {
  if (payload === undefined) return null;
  return payload;
}

export async function recordInnertubePayload(requestType: InnertubeRequestType, requestKey: string | null, payload: any): Promise<void> {
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
