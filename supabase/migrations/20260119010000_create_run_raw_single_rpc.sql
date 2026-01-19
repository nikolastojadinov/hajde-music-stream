BEGIN;

-- Dedicated RPC for single-payload SELECT statements (e.g., advisory locks).
-- Security: limited to service_role, SECURITY DEFINER to bypass RLS where needed.

DROP FUNCTION IF EXISTS public.run_raw_single(text);

CREATE OR REPLACE FUNCTION public.run_raw_single(sql text)
RETURNS TABLE (
  payload jsonb
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'run_raw_single is restricted to service_role';
  END IF;

  RETURN QUERY EXECUTE sql;
END;
$$;

GRANT EXECUTE ON FUNCTION public.run_raw_single(text) TO service_role;

COMMIT;
