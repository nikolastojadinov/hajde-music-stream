/**
 * Track Writer - UPSERT tracks + INSERT playlist_tracks
 *
 * FIX:
 * - tracks više NE smeju da sadrže playlist_id (to pravi UPDATE konflikt)
 * - sada radimo:
 *    1) upsert tracks (jedan video = jedan track)
 *    2) insert playlist_tracks (playlist-track veza)
 */

import supabase from '../services/supabaseClient.js';

const TRACK_BATCH = 100;
const PT_BATCH = 200;

/**
 * Writes (upserts) tracks and links them to playlist via playlist_tracks.
 *
 * @param {string} playlistId
 * @param {Array<Object>} youtubeItems
 * @param {string} newEtag
 * @returns {Promise<{trackIds: string[], etag: string}>}
 */
export async function writeTracks(playlistId, youtubeItems, newEtag) {
  if (!youtubeItems || youtubeItems.length === 0) {
    console.log('[trackWriter] No items to write');
    return { trackIds: [], etag: newEtag };
  }

  const now = new Date().toISOString();

  // TRACK RECORDS (NO playlist_id!)
  const tracks = youtubeItems.map(item => ({
    external_id: item.videoId,
    youtube_id: item.videoId,
    title: item.title || 'Untitled',
    artist: item.channelTitle || 'Unknown Artist',
    cover_url: item.thumbnailUrl || null,
    last_synced_at: now,
  }));

  // 1️⃣ UPSERT TRACKS
  const trackIds = await upsertTracksInBatches(tracks);

  // Map trackIds by position (because we insert playlist_tracks by order)
  const playlistTrackRecords = trackIds.map((trackId, index) => ({
    playlist_id: playlistId,
    track_id: trackId,
    position: index,
    added_at: now,
  }));

  // 2️⃣ INSERT playlist_tracks ENTRIES
  await insertPlaylistTrackLinks(playlistTrackRecords);

  return { trackIds, etag: newEtag };
}

/**
 * UPSERT tracks in batches
 */
async function upsertTracksInBatches(tracks) {
  const chunks = chunkArray(tracks, TRACK_BATCH);
  const allTrackIds = [];

  for (const batch of chunks) {
    const ids = await upsertTrackBatch(batch);
    allTrackIds.push(...ids);
  }

  return allTrackIds;
}

/**
 * UPSERT track batch
 */
async function upsertTrackBatch(batch) {
  const { data, error } = await supabase
    .from('tracks')
    .upsert(batch, {
      onConflict: 'external_id',
      ignoreDuplicates: false,
    })
    .select('id');

  if (error) {
    console.error('[trackWriter] Upsert error', error.message);
    throw error;
  }

  return data.map(r => r.id);
}

/**
 * INSERT playlist_tracks links in batches
 */
async function insertPlaylistTrackLinks(records) {
  const chunks = chunkArray(records, PT_BATCH);

  for (const batch of chunks) {
    const { error } = await supabase
      .from('playlist_tracks')
      .insert(batch);

    if (error) {
      // We do NOT stop the whole process; just log
      console.error('[trackWriter] playlist_tracks insert error', error.message);
    }
  }
}

/**
 * Helper: Split into chunks
 */
function chunkArray(arr, size) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) {
    out.push(arr.slice(i, i + size));
  }
  return out;
}
