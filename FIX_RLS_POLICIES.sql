-- ========================================
-- FIX RLS POLICIES - Allow Service Role Access
-- ========================================
-- Execute this in Supabase SQL Editor
-- This fixes the database_error by allowing service role to manage users
-- ========================================

-- Drop all existing policies
DROP POLICY IF EXISTS "Users can view their own data" ON public.users;
DROP POLICY IF EXISTS "Service role can insert users" ON public.users;
DROP POLICY IF EXISTS "Service role can update users" ON public.users;
DROP POLICY IF EXISTS "Users can view their own sessions" ON public.sessions;
DROP POLICY IF EXISTS "Service role can manage sessions" ON public.sessions;

-- Create permissive policies that allow service role to do everything
CREATE POLICY "Allow all operations for authenticated service role"
ON public.users
FOR ALL
TO authenticated, service_role
USING (true)
WITH CHECK (true);

CREATE POLICY "Allow public read access to users"
ON public.users
FOR SELECT
TO anon, public
USING (true);

CREATE POLICY "Allow all operations for service role on sessions"
ON public.sessions
FOR ALL
TO authenticated, service_role
USING (true)
WITH CHECK (true);

-- Verify policies were created
SELECT 
  schemaname,
  tablename,
  policyname,
  roles,
  cmd
FROM pg_policies
WHERE tablename IN ('users', 'sessions')
ORDER BY tablename, policyname;
