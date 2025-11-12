const path = require('path');
const { createClient } = require('@supabase/supabase-js');
// Ensure we load env vars from backend/.env even if run from repo root
require('dotenv').config({ path: path.resolve(__dirname, '../../.env') });

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function testConnection() {
  console.log('🔍 Testing Supabase connection (backend)...');
  const { data, error } = await supabase.from('playlists').select('id').limit(1);
  if (error) console.error('❌ Supabase connection failed:', error.message);
  else console.log('✅ Backend Supabase connection OK:', data?.[0]?.id || 'no playlists yet');
}

if (require.main === module) {
  testConnection().catch((e) => {
    console.error('❌ Test errored:', e?.message || e);
    process.exit(1);
  });
}
