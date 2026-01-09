-- Most Popular home section: candidate table, refresh helper, policies, and section seed.
-- Safe to re-run.

BEGIN;

CREATE TABLE IF NOT EXISTS public.most_popular_home_candidates (
  playlist_id uuid PRIMARY KEY,
  external_id text,
  title text,
  cover_url text,
  image_url text,
  views_count bigint,
  playlist_views_total bigint,
  playlist_views_7d bigint,
  last_viewed_at timestamptz,
  refreshed_at timestamptz NOT NULL DEFAULT now()
);

-- Aggregate helpers and refresh routine (service role executes this)
CREATE OR REPLACE FUNCTION public.refresh_most_popular_home_candidates(max_limit integer DEFAULT 60)
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
  target_limit integer := COALESCE(max_limit, 60);
BEGIN
  TRUNCATE TABLE public.most_popular_home_candidates;

  INSERT INTO public.most_popular_home_candidates (
    playlist_id,
    external_id,
    title,
    cover_url,
    image_url,
    views_count,
    playlist_views_total,
    playlist_views_7d,
    last_viewed_at,
    refreshed_at
  )
  WITH recent_views AS (
    SELECT
      pv.playlist_id,
      SUM(pv.view_count)::bigint AS playlist_views_7d,
      MAX(pv.last_viewed_at) AS recent_viewed_at
    FROM public.playlist_views pv
    WHERE pv.last_viewed_at >= now() - interval '7 days'
    GROUP BY pv.playlist_id
  ),
  all_time_views AS (
    SELECT
      pv.playlist_id,
      SUM(pv.view_count)::bigint AS playlist_views_total,
      MAX(pv.last_viewed_at) AS last_viewed_at
    FROM public.playlist_views pv
    GROUP BY pv.playlist_id
  )
  SELECT
    p.id AS playlist_id,
    p.external_id,
    p.title,
    p.cover_url,
    p.cover_url AS image_url,
    p.view_count,
    COALESCE(atv.playlist_views_total, 0)::bigint AS playlist_views_total,
    COALESCE(rv.playlist_views_7d, 0)::bigint AS playlist_views_7d,
    COALESCE(rv.recent_viewed_at, atv.last_viewed_at) AS last_viewed_at,
    now() AS refreshed_at
  FROM public.playlists p
  LEFT JOIN recent_views rv ON rv.playlist_id = p.id
  LEFT JOIN all_time_views atv ON atv.playlist_id = p.id
  WHERE p.is_public IS NOT FALSE
    AND p.external_id IS NOT NULL
    AND char_length(p.external_id) BETWEEN 10 AND 60
    AND p.channel_id IS NOT NULL
    AND COALESCE(p.broken, false) = false
    AND COALESCE(p.unstable, false) = false
    AND COALESCE(p.is_empty, false) = false
  ORDER BY COALESCE(p.view_count, 0) DESC,
           COALESCE(atv.playlist_views_total, 0) DESC NULLS LAST,
           COALESCE(rv.playlist_views_7d, 0) DESC,
           COALESCE(rv.recent_viewed_at, atv.last_viewed_at) DESC NULLS LAST
  LIMIT target_limit;
END;
$$;

-- Initial populate
SELECT public.refresh_most_popular_home_candidates(80);

-- RLS and policies
ALTER TABLE public.most_popular_home_candidates ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE policyname = 'Public select most_popular_home_candidates' AND tablename = 'most_popular_home_candidates'
  ) THEN
    CREATE POLICY "Public select most_popular_home_candidates"
      ON public.most_popular_home_candidates
      FOR SELECT
      USING (auth.role() IN ('anon','authenticated','service_role'));
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE policyname = 'Service role manages most_popular_home_candidates' AND tablename = 'most_popular_home_candidates'
  ) THEN
    CREATE POLICY "Service role manages most_popular_home_candidates"
      ON public.most_popular_home_candidates
      USING (auth.role() = 'service_role')
      WITH CHECK (auth.role() = 'service_role');
  END IF;
END $$;

GRANT USAGE ON SCHEMA public TO service_role;
GRANT ALL PRIVILEGES ON TABLE public.most_popular_home_candidates TO service_role;
GRANT SELECT ON TABLE public.most_popular_home_candidates TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.refresh_most_popular_home_candidates(integer) TO service_role;

CREATE INDEX IF NOT EXISTS idx_most_popular_home_candidates_views
  ON public.most_popular_home_candidates(views_count DESC NULLS LAST, playlist_views_total DESC NULLS LAST);

CREATE INDEX IF NOT EXISTS idx_most_popular_home_candidates_refreshed
  ON public.most_popular_home_candidates(refreshed_at DESC);

-- Seed the Most Popular section definition
INSERT INTO public.home_sections (key, title, is_active, refresh_policy)
VALUES (
  'most_popular',
  'Most Popular',
  true,
  jsonb_build_object('type','interval','interval','weekly','preferred_window','02:00-04:00 UTC')
)
ON CONFLICT (key) DO UPDATE
SET title = EXCLUDED.title,
    is_active = EXCLUDED.is_active,
    refresh_policy = EXCLUDED.refresh_policy,
    updated_at = now();

COMMIT;
