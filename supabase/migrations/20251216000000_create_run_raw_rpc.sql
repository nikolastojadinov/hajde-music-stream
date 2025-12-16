BEGIN;

-- Minimal RPC used by backend/src/services/supabaseClient.ts (searchPlaylistsDualForQuery).
-- It executes a very specific SELECT statement and returns two jsonb columns.
--
-- Security:
-- - SECURITY DEFINER so it can read underlying tables even if RLS is enabled.
-- - Hard-gated to service_role.
--
-- NOTE: This is intentionally NOT a general-purpose SQL executor.

-- If the function already exists with a different return type, Postgres will error on
-- CREATE OR REPLACE. Drop first to allow recreating with the correct signature.
DROP FUNCTION IF EXISTS public.run_raw(text);

CREATE OR REPLACE FUNCTION public.run_raw(sql text)
RETURNS TABLE (
  playlists_by_title jsonb,
  playlists_by_artist jsonb
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- NULL-safe check: if auth.role() is NULL, this must still reject.
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'run_raw is restricted to service_role';
  END IF;

  RETURN QUERY EXECUTE sql;
END;
$$;

-- Ensure service_role can call it (usually implicit, but explicit grant is clearer).
GRANT EXECUTE ON FUNCTION public.run_raw(text) TO service_role;

COMMIT;
