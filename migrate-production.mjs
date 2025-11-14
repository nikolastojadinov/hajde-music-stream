// Jednostavno: Idi na Supabase Dashboard > SQL Editor i pokreni PRODUCTION_MIGRATION.sql
// Ili koristi ovaj Node script ako želiš automatizaciju

import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.VITE_SUPABASE_URL;
const SUPABASE_KEY = process.env.VITE_SUPABASE_ANON_KEY;

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('❌ Missing Supabase credentials!');
  console.log('Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY environment variables');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

async function checkColumns() {
  console.log('🔍 Checking current database schema...\n');
  
  // Proveri playlists
  const { data: playlists, error: playlistsErr } = await supabase
    .from('playlists')
    .select('*')
    .limit(1);
  
  if (!playlistsErr && playlists && playlists.length > 0) {
    console.log('✅ Playlists columns:', Object.keys(playlists[0]));
  } else {
    console.log('⚠️  Playlists error:', playlistsErr?.message || 'No data');
  }

  // Proveri tracks
  const { data: tracks, error: tracksErr } = await supabase
    .from('tracks')
    .select('*')
    .limit(1);
  
  if (!tracksErr && tracks && tracks.length > 0) {
    console.log('✅ Tracks columns:', Object.keys(tracks[0]));
  } else {
    console.log('⚠️  Tracks error:', tracksErr?.message || 'No data');
  }

  console.log('\n📋 To add image_url columns, run PRODUCTION_MIGRATION.sql in Supabase Dashboard > SQL Editor');
}

checkColumns();
