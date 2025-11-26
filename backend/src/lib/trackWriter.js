/**
 * Track Writer - UPSERT-based track management
 * 
 * Fixes "duplicate key value violates unique constraint uq_tracks_external_id"
 * by using proper UPSERT with ON CONFLICT (external_id) DO UPDATE.
 * 
 * NO deletes, NO sync_status, NO delta sync - only insert or update.
 */

import supabase from '../services/supabaseClient.js';

const BATCH_SIZE = 100;

/**
 * Write tracks to database using UPSERT.
 * Inserts new tracks or updates existing ones based on external_id.
 * 
 * @param {string} playlistId - Playlist UUID
 * @param {Array<Object>} youtubeItems - YouTube items: { videoId, title, channelTitle, thumbnailUrl, position }
 * @param {string} newEtag - New ETag to return (caller will store it)
 * @returns {Promise<{trackIds: string[], etag: string}>}
 */
export async function writeTracks(playlistId, youtubeItems, newEtag) {
  if (!youtubeItems || youtubeItems.length === 0) {
    console.log('[trackWriter] No items to write');
    return { trackIds: [], etag: newEtag };
  }

  const now = new Date().toISOString();
  
  // Map YouTube items to track records
  const trackRecords = youtubeItems.map(item => ({
    external_id: item.videoId,
    youtube_id: item.videoId,
    title: item.title || 'Untitled',
    artist: item.channelTitle || 'Unknown Artist',
    cover_url: item.thumbnailUrl || null,
    playlist_id: playlistId,
    last_synced_at: now,
  }));

  const allTrackIds = [];
  const batches = chunkArray(trackRecords, BATCH_SIZE);

  console.log('[trackWriter] Writing tracks', {
    playlistId,
    total: trackRecords.length,
    batches: batches.length,
  });

  // Process each batch
  for (let i = 0; i < batches.length; i++) {
    const batch = batches[i];
    
    try {
      const trackIds = await upsertBatch(batch);
      allTrackIds.push(...trackIds);
      
      console.log('[trackWriter] Batch complete', {
        batch: i + 1,
        total: batches.length,
        count: trackIds.length,
      });
    } catch (error) {
      // Log error but continue with next batch
      console.error('[trackWriter] Batch failed, continuing', {
        batch: i + 1,
        error: error.message,
      });
    }
  }

  return { trackIds: allTrackIds, etag: newEtag };
}

/**
 * Upsert a batch of tracks.
 * ON CONFLICT (external_id) DO UPDATE.
 * 
 * @param {Array<Object>} batch - Track records
 * @returns {Promise<string[]>} - Array of track IDs
 */
async function upsertBatch(batch) {
  const { data, error } = await supabase
    .from('tracks')
    .upsert(batch, {
      onConflict: 'external_id',
      ignoreDuplicates: false, // We want UPDATE on conflict
    })
    .select('id');

  if (error) {
    console.error('[trackWriter] Upsert error', {
      message: error.message,
      code: error.code,
    });
    throw error;
  }

  return data ? data.map(row => row.id) : [];
}

/**
 * Split array into chunks.
 * 
 * @param {Array} array - Input array
 * @param {number} size - Chunk size
 * @returns {Array<Array>} - Array of chunks
 */
function chunkArray(array, size) {
  const chunks = [];
  for (let i = 0; i < array.length; i += size) {
    chunks.push(array.slice(i, i + size));
  }
  return chunks;
}
