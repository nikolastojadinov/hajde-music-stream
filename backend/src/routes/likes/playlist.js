const express = require('express');
const { createClient } = require('@supabase/supabase-js');

const router = express.Router();

function getClient() {
  const url = process.env.EXTERNAL_SUPABASE_URL;
  const serviceKey = process.env.EXTERNAL_SUPABASE_SERVICE_ROLE;
  if (!url || !serviceKey) {
    throw new Error('Missing EXTERNAL_SUPABASE_URL or EXTERNAL_SUPABASE_SERVICE_ROLE');
  }
  return createClient(url, serviceKey, { auth: { persistSession: false } });
}

async function ensurePlaylistExists(client, playlistId) {
  const { data, error } = await client
    .from('playlists')
    .select('id')
    .eq('id', playlistId)
    .limit(1)
    .single();
  if (error || !data) {
    return false;
  }
  return true;
}

// POST /likes/playlist  { user_id, playlist_id }
router.post('/playlist', async (req, res) => {
  try {
    const { user_id, playlist_id } = req.body || {};
    if (!user_id || !playlist_id) {
      return res.status(400).json({ success: false, error: 'user_id and playlist_id are required' });
    }

    const client = getClient();

    const exists = await ensurePlaylistExists(client, String(playlist_id));
    if (!exists) {
      return res.status(404).json({ success: false, error: 'playlist_not_found' });
    }

    // Insert like (idempotens: upsert, ha composite unique létezik)
    const { error } = await client
      .from('playlist_likes')
      .upsert({ user_id: String(user_id), playlist_id: String(playlist_id) }, { onConflict: 'user_id,playlist_id' });

    if (error) {
      return res.status(500).json({ success: false, error: error.message });
    }
    return res.json({ success: true });
  } catch (e) {
    return res.status(500).json({ success: false, error: e.message || 'server_error' });
  }
});

// DELETE /likes/playlist  { user_id, playlist_id }
router.delete('/playlist', async (req, res) => {
  try {
    const { user_id, playlist_id } = req.body || {};
    if (!user_id || !playlist_id) {
      return res.status(400).json({ success: false, error: 'user_id and playlist_id are required' });
    }

    const client = getClient();

    const { error } = await client
      .from('playlist_likes')
      .delete()
      .eq('user_id', String(user_id))
      .eq('playlist_id', String(playlist_id));

    if (error) {
      return res.status(500).json({ success: false, error: error.message });
    }
    return res.json({ success: true });
  } catch (e) {
    return res.status(500).json({ success: false, error: e.message || 'server_error' });
  }
});

module.exports = router;
