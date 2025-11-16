import { createClient } from '@supabase/supabase-js';

// External Supabase connection for the playlist database
// This connects to the SAME Supabase instance that stores playlists, tracks, and playlist_tracks
const EXTERNAL_SUPABASE_URL = 'https://ofkfygqrfenctzitigae.supabase.co';
const EXTERNAL_SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9ma2Z5Z3FyZmVuY3R6aXRpZ2FlIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTc2NjgwMjcsImV4cCI6MjA3MzI0NDAyN30.-GFl3-IncJ7hno_LHE5jtCOe_HI07nxwiq3aaISHolo';

export const externalSupabase = createClient(
  EXTERNAL_SUPABASE_URL, 
  EXTERNAL_SUPABASE_ANON_KEY, 
  {
    auth: {
      persistSession: false, // No authentication needed for public playlist access
    },
    db: {
      schema: 'public', // Explicitly use public schema
    },
  }
);

console.log('✅ [externalSupabase] Client initialized:', {
  url: EXTERNAL_SUPABASE_URL,
  schema: 'public',
  tables: ['playlists', 'tracks', 'playlist_tracks']
});
