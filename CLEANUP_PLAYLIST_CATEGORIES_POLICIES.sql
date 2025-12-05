-- ========================================
-- CLEANUP: Uklanjanje starih/duplikat policies
-- ========================================
-- Posle primene FIX_PLAYLIST_CATEGORIES_RLS.sql,
-- potrebno je očistiti stare policies koje su duplikati
-- ili parcijalno implementirane.
-- ========================================

-- Ukloniti stare policies koje su zamenjene novim
DROP POLICY IF EXISTS "allow_service_role_all" ON public.playlist_categories;
DROP POLICY IF EXISTS "service_insert_playlist_categories" ON public.playlist_categories;

-- ========================================
-- VERIFIKACIJA - trebalo bi da ostanu samo 3 policy:
-- ========================================
-- 1. Service role can manage playlist_categories (service_role, ALL)
-- 2. Users can manage their playlist categories (authenticated, ALL)  
-- 3. Anyone can view playlist_categories (public, SELECT)
-- ========================================

SELECT 
  tablename,
  policyname,
  roles,
  cmd
FROM pg_policies
WHERE tablename = 'playlist_categories'
ORDER BY policyname;
