-- Recent searches per user with Spotify-like behavior
-- Adds table, indexes, RLS, and an upsert helper enforcing a 20-item cap per user.

BEGIN;

CREATE TABLE IF NOT EXISTS public.user_recent_searches (
  id BIGSERIAL PRIMARY KEY,
  user_id text NOT NULL,
  query text NOT NULL,
  entity_type text NOT NULL DEFAULT 'generic',
  entity_id text,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_used_at timestamptz NOT NULL DEFAULT now(),
  use_count integer NOT NULL DEFAULT 1,
  CONSTRAINT user_recent_searches_entity_type_check CHECK (entity_type IN ('artist', 'song', 'playlist', 'album', 'generic')),
  CONSTRAINT user_recent_searches_user_query_unique UNIQUE (user_id, query)
);

CREATE INDEX IF NOT EXISTS idx_user_recent_searches_user_ts
  ON public.user_recent_searches(user_id, last_used_at DESC);

CREATE INDEX IF NOT EXISTS idx_user_recent_searches_user_created
  ON public.user_recent_searches(user_id, created_at DESC);

-- RLS: users can only see and mutate their own rows
ALTER TABLE public.user_recent_searches ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'user_recent_searches' AND policyname = 'Users can view their own recent searches'
  ) THEN
    CREATE POLICY "Users can view their own recent searches"
      ON public.user_recent_searches FOR SELECT
      USING (auth.uid()::text = user_id);
  END IF;
END$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'user_recent_searches' AND policyname = 'Users can insert their own recent searches'
  ) THEN
    CREATE POLICY "Users can insert their own recent searches"
      ON public.user_recent_searches FOR INSERT
      WITH CHECK (auth.uid()::text = user_id);
  END IF;
END$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'user_recent_searches' AND policyname = 'Users can update their own recent searches'
  ) THEN
    CREATE POLICY "Users can update their own recent searches"
      ON public.user_recent_searches FOR UPDATE
      USING (auth.uid()::text = user_id);
  END IF;
END$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'user_recent_searches' AND policyname = 'Users can delete their own recent searches'
  ) THEN
    CREATE POLICY "Users can delete their own recent searches"
      ON public.user_recent_searches FOR DELETE
      USING (auth.uid()::text = user_id);
  END IF;
END$$;

-- Upsert helper: updates last_used_at/use_count and enforces a 20-item cap per user
CREATE OR REPLACE FUNCTION public.upsert_user_recent_search(
  p_user_id text,
  p_query text,
  p_entity_type text DEFAULT 'generic',
  p_entity_id text DEFAULT NULL
) RETURNS public.user_recent_searches
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user text := trim(coalesce(p_user_id, ''));
  v_query text := trim(coalesce(p_query, ''));
  v_row public.user_recent_searches;
BEGIN
  IF v_user = '' THEN
    RAISE EXCEPTION 'user_id_required';
  END IF;
  IF v_query = '' THEN
    RAISE EXCEPTION 'query_required';
  END IF;

  INSERT INTO public.user_recent_searches (user_id, query, entity_type, entity_id, last_used_at)
  VALUES (v_user, v_query, coalesce(nullif(trim(p_entity_type), ''), 'generic'), p_entity_id, now())
  ON CONFLICT (user_id, query) DO UPDATE
    SET last_used_at = now(),
        use_count = public.user_recent_searches.use_count + 1,
        entity_type = EXCLUDED.entity_type,
        entity_id = EXCLUDED.entity_id
  RETURNING * INTO v_row;

  DELETE FROM public.user_recent_searches urs
  WHERE urs.user_id = v_user
    AND urs.id NOT IN (
      SELECT id FROM public.user_recent_searches
      WHERE user_id = v_user
      ORDER BY last_used_at DESC, id DESC
      LIMIT 20
    );

  RETURN v_row;
END;
$$;

GRANT EXECUTE ON FUNCTION public.upsert_user_recent_search(text, text, text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.upsert_user_recent_search(text, text, text, text) TO authenticated;

COMMIT;
