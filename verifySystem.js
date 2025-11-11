import { createClient } from '@supabase/supabase-js'
import fetch from 'node-fetch'

const SUPABASE_URL = process.env.SUPABASE_URL
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
const BACKEND_URL = process.env.FRONTEND_URL?.replace('netlify.app', 'onrender.com') || process.env.BACKEND_URL

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)

async function verifySystem() {
  console.log('🔍 Running Purple Music System Verification...')

  // 1️⃣ Backend health check
  try {
    const res = await fetch(`${BACKEND_URL}/health`)
    const data = await res.json()
    if (data.status === 'ok') console.log('✅ Backend is alive:', data)
    else console.error('❌ Backend returned invalid response:', data)
  } catch (err) {
    console.error('❌ Backend not reachable:', err.message)
  }

  // 2️⃣ Supabase connection test
  try {
    const { data, error } = await supabase.from('users').select('id').limit(1)
    if (error) throw error
    console.log('✅ Supabase connection OK, found users:', data?.length)
  } catch (err) {
    console.error('❌ Supabase connection failed:', err.message)
  }

  // 3️⃣ PiAuth login test
  try {
    const username = 'testuser_' + Math.floor(Math.random() * 9999)
    const wallet = 'pi_test_wallet_' + Math.floor(Math.random() * 9999)
    const { error } = await supabase.from('users').insert([{ wallet, user_consent: true, created_at: new Date(), username }])
    if (error) throw error
    console.log('✅ PiAuth simulated login created user:', username)
  } catch (err) {
    console.error('❌ PiAuth user insert failed:', err.message)
  }

  // 4️⃣ Data persistence check
  try {
    const { data, error } = await supabase.from('users').select('*').order('created_at', { ascending: false }).limit(1)
    if (error) throw error
    console.log('✅ Last user record:', data[0])
  } catch (err) {
    console.error('❌ Could not verify stored user:', err.message)
  }

  console.log('✅ Purple Music system verification complete.')
}

verifySystem()
