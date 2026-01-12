import supabase from './supabaseClient';

export type InnertubeRequestType = 'search' | 'browse' | 'playlist' | 'artist' | 'album';

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
    const { error } = await supabase.from('innertube_raw_payloads').insert({
      request_type: requestType,
      request_key: requestKey,
      payload: safePayload(payload),
      status: 'pending',
    });

    if (error) {
      console.error('[innertubeRawStore] failed to insert payload', { requestType, requestKey, error: error.message });
    }
  } catch (err: any) {
    console.error('[innertubeRawStore] unexpected error', { requestType, requestKey, message: err?.message });
  }
}
