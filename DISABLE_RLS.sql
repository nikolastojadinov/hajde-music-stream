-- ========================================
-- QUICK FIX: Disable RLS Temporarily
-- ========================================
-- This will help us identify if RLS is blocking the inserts
-- Execute this in Supabase SQL Editor
-- ========================================

-- Disable RLS on users and sessions tables
ALTER TABLE public.users DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.sessions DISABLE ROW LEVEL SECURITY;

-- Verify RLS status
SELECT 
  schemaname,
  tablename,
  rowsecurity as rls_enabled
FROM pg_tables
WHERE tablename IN ('users', 'sessions')
ORDER BY tablename;
