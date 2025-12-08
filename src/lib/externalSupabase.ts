import { createClient } from '@supabase/supabase-js';

// External Supabase connection for the original playlist database
export const EXTERNAL_SUPABASE_URL = 'https://ofkfygqrfenctzitigae.supabase.co';
export const EXTERNAL_SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9ma2Z5Z3FyZmVuY3R6aXRpZ2FlIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTc2NjgwMjcsImV4cCI6MjA3MzI0NDAyN30.-GFl3-IncJ7hno_LHE5jtCOe_HI07nxwiq3aaISHolo';

export const externalSupabase = createClient(EXTERNAL_SUPABASE_URL, EXTERNAL_SUPABASE_ANON_KEY, {
  auth: {
    persistSession: false,
  }
});
