-- Enforce auth.uid() ownership for user_recent_searches and remove user_id parameter requirements.

BEGIN;

-- Align column type with Supabase auth uid and avoid text-based inserts.
ALTER TABLE public.user_recent_searches
  ALTER COLUMN user_id TYPE uuid USING user_id::uuid;

-- Enforce RLS consistently.
ALTER TABLE public.user_recent_searches ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_recent_searches FORCE ROW LEVEL SECURITY;

-- Refresh policies to rely on auth.uid().
DROP POLICY IF EXISTS "Users can view their own recent searches" ON public.user_recent_searches;
DROP POLICY IF EXISTS "Users can insert their own recent searches" ON public.user_recent_searches;
DROP POLICY IF EXISTS "Users can update their own recent searches" ON public.user_recent_searches;
DROP POLICY IF EXISTS "Users can delete their own recent searches" ON public.user_recent_searches;

CREATE POLICY "Users can view their own recent searches"
  ON public.user_recent_searches FOR SELECT
  USING (user_id = auth.uid());

CREATE POLICY "Users can insert their own recent searches"
  ON public.user_recent_searches FOR INSERT
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "Users can update their own recent searches"
  ON public.user_recent_searches FOR UPDATE
  USING (user_id = auth.uid());

CREATE POLICY "Users can delete their own recent searches"
  ON public.user_recent_searches FOR DELETE
  USING (user_id = auth.uid());

-- Replace upsert helper to source identity from auth.uid().
DROP FUNCTION IF EXISTS public.upsert_user_recent_search(text, text, text, text);
DROP FUNCTION IF EXISTS public.upsert_user_recent_search(text, text, text);

CREATE OR REPLACE FUNCTION public.upsert_user_recent_search(
  p_query text,
  p_entity_type text DEFAULT 'generic',
  p_entity_id text DEFAULT NULL
) RETURNS public.user_recent_searches
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_query text := trim(coalesce(p_query, ''));
  v_entity_type text := coalesce(nullif(trim(p_entity_type), ''), 'generic');
  v_row public.user_recent_searches;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'auth_required';
  END IF;
  IF v_query = '' THEN
    RAISE EXCEPTION 'query_required';
  END IF;

  INSERT INTO public.user_recent_searches (user_id, query, entity_type, entity_id, last_used_at)
  VALUES (v_uid, v_query, v_entity_type, p_entity_id, now())
  ON CONFLICT (user_id, query) DO UPDATE
    SET last_used_at = now(),
        use_count = public.user_recent_searches.use_count + 1,
        entity_type = EXCLUDED.entity_type,
        entity_id = EXCLUDED.entity_id
  RETURNING * INTO v_row;

  DELETE FROM public.user_recent_searches urs
  WHERE urs.user_id = v_uid
    AND urs.id NOT IN (
      SELECT id FROM public.user_recent_searches
      WHERE user_id = v_uid
      ORDER BY last_used_at DESC, id DESC
      LIMIT 20
    );

  RETURN v_row;
END;
$$;

GRANT EXECUTE ON FUNCTION public.upsert_user_recent_search(text, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.upsert_user_recent_search(text, text, text) TO service_role;

COMMIT;
