-- ========================================
-- FIX: playlist_categories RLS Policies
-- ========================================
-- PROBLEM: 
-- Tabela playlist_categories nema definisanu RLS policy za INSERT
-- što blokira snimanje izmenjenih playlist-a kada se kategorije šalju
-- (čak i kad nisu menjane - npr. samo upload cover slike).
--
-- GREŠKA: "new row violates row-level security policy"
--
-- REŠENJE:
-- Dodati kompletne RLS policies za playlist_categories tabelu.
-- ========================================

-- 1. Enable RLS ako već nije
ALTER TABLE public.playlist_categories ENABLE ROW LEVEL SECURITY;

-- 2. Drop postojeće policies (ako postoje)
DROP POLICY IF EXISTS "Service role can manage playlist_categories" ON public.playlist_categories;
DROP POLICY IF EXISTS "Users can manage their playlist categories" ON public.playlist_categories;
DROP POLICY IF EXISTS "Anyone can view playlist_categories" ON public.playlist_categories;

-- 3. Service role full access (za backend operacije)
CREATE POLICY "Service role can manage playlist_categories"
ON public.playlist_categories
FOR ALL
TO service_role
USING (true)
WITH CHECK (true);

-- 4. Authenticated users mogu da upravljaju kategorijama SVOJIH playlist-a
CREATE POLICY "Users can manage their playlist categories"
ON public.playlist_categories
FOR ALL
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.playlists
    WHERE playlists.id = playlist_categories.playlist_id
    AND playlists.owner_id = auth.uid()
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.playlists
    WHERE playlists.id = playlist_categories.playlist_id
    AND playlists.owner_id = auth.uid()
  )
);

-- 5. Public read access (svi mogu da vide kategorije)
CREATE POLICY "Anyone can view playlist_categories"
ON public.playlist_categories
FOR SELECT
USING (true);

-- ========================================
-- VERIFIKACIJA
-- ========================================

-- Proveri RLS status
SELECT 
  schemaname,
  tablename,
  rowsecurity as rls_enabled
FROM pg_tables
WHERE tablename = 'playlist_categories';

-- Proveri policies
SELECT 
  schemaname,
  tablename,
  policyname,
  roles,
  cmd,
  qual,
  with_check
FROM pg_policies
WHERE tablename = 'playlist_categories'
ORDER BY policyname;

-- ========================================
-- TEST QUERY
-- ========================================
-- Ovo bi trebalo da radi BEZ greške nakon primene fix-a:
-- 
-- DELETE FROM playlist_categories WHERE playlist_id = 'some-uuid';
-- INSERT INTO playlist_categories (playlist_id, category_id) 
-- VALUES ('some-uuid', 123);
-- ========================================
