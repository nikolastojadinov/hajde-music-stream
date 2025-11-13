import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

dotenv.config();

const supabase = createClient(
  process.env.VITE_SUPABASE_URL,
  process.env.VITE_SUPABASE_PUBLISHABLE_KEY
);

async function testSupabaseConnection() {
  try {
    console.log('Testing Supabase connection...');
    console.log('VITE_SUPABASE_URL:', process.env.VITE_SUPABASE_URL);
    console.log('VITE_SUPABASE_PUBLISHABLE_KEY:', process.env.VITE_SUPABASE_PUBLISHABLE_KEY ? 'Set' : 'Not set');
    
    // Test playlists query
    const { data: playlists, error } = await supabase
      .from('playlists')
      .select('*')
      .order('created_at', { ascending: false });
    
    if (error) {
      console.error('Error fetching playlists:', error);
      return;
    }
    
    console.log('\n=== PLAYLISTS IN DATABASE ===');
    console.log('Total playlists:', playlists?.length || 0);
    
    if (playlists && playlists.length > 0) {
      playlists.forEach((playlist, index) => {
        console.log(`${index + 1}. ${playlist.title}`);
        console.log(`   Category: ${playlist.category || 'N/A'}`);
        console.log(`   Description: ${playlist.description || 'N/A'}`);
        console.log(`   ID: ${playlist.id}`);
        console.log('');
      });
    } else {
      console.log('No playlists found in database.');
    }
    
    // Group by category
    const categories = {};
    playlists?.forEach(playlist => {
      const cat = playlist.category || 'uncategorized';
      if (!categories[cat]) categories[cat] = [];
      categories[cat].push(playlist);
    });
    
    console.log('\n=== PLAYLISTS BY CATEGORY ===');
    Object.keys(categories).forEach(category => {
      console.log(`${category.toUpperCase()}: ${categories[category].length} playlists`);
      categories[category].forEach(p => console.log(`  - ${p.title}`));
    });
    
  } catch (error) {
    console.error('Connection test failed:', error);
  }
}

testSupabaseConnection();