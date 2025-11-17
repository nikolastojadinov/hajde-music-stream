-- ========================================
-- FIX: Grant Permissions to Service Role
-- ========================================
-- Execute this in Supabase SQL Editor
-- Error: permission denied for table users (42501)
-- ========================================

-- Grant ALL privileges on users table to authenticated and service_role
GRANT ALL ON TABLE public.users TO authenticated;
GRANT ALL ON TABLE public.users TO service_role;
GRANT ALL ON TABLE public.users TO postgres;

-- Grant ALL privileges on sessions table to authenticated and service_role
GRANT ALL ON TABLE public.sessions TO authenticated;
GRANT ALL ON TABLE public.sessions TO service_role;
GRANT ALL ON TABLE public.sessions TO postgres;

-- Grant USAGE on sequences (if any)
GRANT USAGE ON ALL SEQUENCES IN SCHEMA public TO authenticated;
GRANT USAGE ON ALL SEQUENCES IN SCHEMA public TO service_role;

-- Verify permissions
SELECT 
  grantee,
  table_schema,
  table_name,
  privilege_type
FROM information_schema.table_privileges
WHERE table_name IN ('users', 'sessions')
  AND table_schema = 'public'
ORDER BY table_name, grantee, privilege_type;
