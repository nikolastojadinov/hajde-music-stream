-- ========================================
-- FIX: Categories Table RLS Policy
-- ========================================
-- Ez a script megoldja a "new row violates row-level security policy" hibát
-- a categories táblán, mivel jelenleg nincs publikus olvasási policy beállítva.
--
-- PROBLÉMA: 
-- - A backend service role-t használ a categories lekérdezésére
-- - A categories tábla RLS-sel védett, de nincs megfelelő policy
-- - Ez blokkol minden lekérdezést, még a service role-t is
--
-- MEGOLDÁS:
-- - Publikus olvasási policy a categories táblára VAGY
-- - RLS kikapcsolása mivel ez egy publikus referencia tábla
-- ========================================

-- OPCIÓ 1: Publikus olvasási policy hozzáadása (ajánlott)
-- Ez megengedi mindenkinek hogy olvassa a categories táblát,
-- de csak a service role írhat/módosíthat

CREATE POLICY "Public read access for categories"
ON public.categories
FOR SELECT
TO anon, public, authenticated
USING (true);

-- Service role írási policy (ha még nincs)
CREATE POLICY "Service role can manage categories"
ON public.categories
FOR ALL
TO service_role
USING (true)
WITH CHECK (true);

-- ========================================
-- OPCIÓ 2: RLS kikapcsolása (alternatíva)
-- ========================================
-- Ha a categories tábla teljesen publikus referencia adat,
-- akkor egyszerűbb kikapcsolni az RLS-t:
--
-- ALTER TABLE public.categories DISABLE ROW LEVEL SECURITY;
-- ========================================

-- Ellenőrzés: nézd meg a jelenlegi policies-t
SELECT 
  schemaname,
  tablename,
  policyname,
  roles,
  cmd,
  qual,
  with_check
FROM pg_policies
WHERE tablename = 'categories'
ORDER BY policyname;

-- Ellenőrzés: RLS státusz
SELECT 
  schemaname,
  tablename,
  rowsecurity as rls_enabled
FROM pg_tables
WHERE tablename = 'categories';
