import { createClient } from '@supabase/supabase-js';

const externalSupabase = createClient(
  'https://ofkfygqrfenctzitigae.supabase.co',
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9ma2Z5Z3FyZmVuY3R6aXRpZ2FlIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTc2NjgwMjcsImV4cCI6MjA3MzI0NDAyN30.-GFl3-IncJ7hno_LHE5jtCOe_HI07nxwiq3aaISHolo',
  { auth: { persistSession: false } }
);

async function runQueries() {
  // 1. Total playlists
  const { count: totalPlaylists } = await externalSupabase
    .from('playlists')
    .select('*', { count: 'exact', head: true });

  // 2. Get all playlist IDs that have tracks
  const { data: playlistTracks } = await externalSupabase
    .from('playlist_tracks')
    .select('playlist_id');
  
  const uniquePlaylistIds = [...new Set(playlistTracks?.map(pt => pt.playlist_id) || [])];
  const playlistsWithTracks = uniquePlaylistIds.length;

  // 3. Total tracks
  const { count: totalTracks } = await externalSupabase
    .from('tracks')
    .select('*', { count: 'exact', head: true });

  console.log('===========================================');
  console.log('REZULTATI:');
  console.log('===========================================');
  console.log('1. Ukupno playlisti:', totalPlaylists);
  console.log('2. Playlisti sa pesmama:', playlistsWithTracks);
  console.log('3. Prazne playliste:', (totalPlaylists || 0) - playlistsWithTracks);
  console.log('4. Ukupno pesama:', totalTracks);
  console.log('===========================================');
}

runQueries().catch(console.error);
