// Quick test to see Supabase data from frontend
import { createClient } from '@supabase/supabase-js';
import 'dotenv/config';

const SUPABASE_URL = process.env.VITE_SUPABASE_URL;
const SUPABASE_KEY = process.env.VITE_SUPABASE_PUBLISHABLE_KEY;

console.log('🔍 Testing Frontend Supabase connection...');
console.log('URL:', SUPABASE_URL);
console.log('Key:', SUPABASE_KEY ? 'Present' : 'Missing');

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

async function testPlaylists() {
  try {
    const { data, error } = await supabase
      .from('playlists')
      .select('*')
      .order('created_at', { ascending: false });

    if (error) {
      console.error('❌ Error:', error.message);
    } else {
      console.log('✅ Found', data.length, 'playlists:');
      data.forEach((playlist, i) => {
        console.log(`${i+1}. "${playlist.title}" (${playlist.category || 'no category'})`);
      });
    }
  } catch (err) {
    console.error('❌ Exception:', err.message);
  }
}

testPlaylists();