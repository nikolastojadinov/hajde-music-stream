-- TrendingNow home section: tables, policies, helper function, and indexes.
-- Safe to re-run; checks guard duplicates.

BEGIN;

-- Base registry for home sections
CREATE TABLE IF NOT EXISTS public.home_sections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  key text UNIQUE NOT NULL,
  title text NOT NULL,
  is_active boolean NOT NULL DEFAULT true,
  refresh_policy jsonb NOT NULL DEFAULT jsonb_build_object(
    'type', 'interval',
    'interval', 'weekly',
    'preferred_window', '02:00-04:00 UTC'
  ),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Keep updated_at in sync
CREATE OR REPLACE FUNCTION public.home_sections_set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'home_sections_set_updated_at'
  ) THEN
    CREATE TRIGGER home_sections_set_updated_at
      BEFORE UPDATE ON public.home_sections
      FOR EACH ROW
      EXECUTE FUNCTION public.home_sections_set_updated_at();
  END IF;
END $$;

-- Snapshots for rendered home sections
CREATE TABLE IF NOT EXISTS public.home_section_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  section_key text NOT NULL,
  payload jsonb NOT NULL,
  generated_at timestamptz NOT NULL DEFAULT now(),
  valid_until timestamptz NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT home_section_snapshots_section_fkey FOREIGN KEY (section_key) REFERENCES public.home_sections(key)
);

-- Optional run log for refresh executions
CREATE TABLE IF NOT EXISTS public.home_section_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  section_key text NOT NULL,
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz NULL,
  status text NOT NULL DEFAULT 'running' CHECK (status IN ('running','success','error')),
  notes text NULL,
  error jsonb NULL DEFAULT '{}'::jsonb
);

-- Helpful indexes
CREATE INDEX IF NOT EXISTS idx_home_sections_key_active ON public.home_sections(key, is_active);
CREATE INDEX IF NOT EXISTS idx_home_section_snapshots_section_generated ON public.home_section_snapshots(section_key, generated_at DESC);
CREATE INDEX IF NOT EXISTS idx_home_section_snapshots_valid_until ON public.home_section_snapshots(section_key, valid_until);
CREATE INDEX IF NOT EXISTS idx_home_section_runs_section_started ON public.home_section_runs(section_key, started_at DESC);

-- Enable RLS
ALTER TABLE public.home_sections ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.home_section_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.home_section_runs ENABLE ROW LEVEL SECURITY;

-- Policies for home_sections (service role only)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE policyname = 'Service role manages home_sections' AND tablename = 'home_sections'
  ) THEN
    CREATE POLICY "Service role manages home_sections"
      ON public.home_sections
      USING (auth.role() = 'service_role')
      WITH CHECK (auth.role() = 'service_role');
  END IF;
END $$;

-- Policies for home_section_runs (service role only)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE policyname = 'Service role manages home_section_runs' AND tablename = 'home_section_runs'
  ) THEN
    CREATE POLICY "Service role manages home_section_runs"
      ON public.home_section_runs
      USING (auth.role() = 'service_role')
      WITH CHECK (auth.role() = 'service_role');
  END IF;
END $$;

-- Policies for home_section_snapshots (public read, service role manage)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE policyname = 'Service role manages home_section_snapshots' AND tablename = 'home_section_snapshots'
  ) THEN
    CREATE POLICY "Service role manages home_section_snapshots"
      ON public.home_section_snapshots
      USING (auth.role() = 'service_role')
      WITH CHECK (auth.role() = 'service_role');
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE policyname = 'Public read home_section_snapshots' AND tablename = 'home_section_snapshots'
  ) THEN
    CREATE POLICY "Public read home_section_snapshots"
      ON public.home_section_snapshots
      FOR SELECT
      USING (
        auth.role() IN ('anon','authenticated','service_role')
        AND EXISTS (
          SELECT 1 FROM public.home_sections hs
          WHERE hs.key = home_section_snapshots.section_key
            AND hs.is_active = true
        )
      );
  END IF;
END $$;

-- Grants
GRANT USAGE ON SCHEMA public TO service_role;
GRANT ALL PRIVILEGES ON TABLE public.home_sections TO service_role;
GRANT ALL PRIVILEGES ON TABLE public.home_section_snapshots TO service_role;
GRANT ALL PRIVILEGES ON TABLE public.home_section_runs TO service_role;
GRANT SELECT ON TABLE public.home_section_snapshots TO anon, authenticated;

-- Seed the TrendingNow section definition
INSERT INTO public.home_sections (key, title, is_active, refresh_policy)
VALUES (
  'trending_now',
  'Trending Now',
  true,
  jsonb_build_object('type','interval','interval','weekly','preferred_window','02:00-04:00 UTC')
)
ON CONFLICT (key) DO UPDATE
SET title = EXCLUDED.title,
    is_active = EXCLUDED.is_active,
    refresh_policy = EXCLUDED.refresh_policy,
    updated_at = now();

-- Supporting indexes for trending calculations
CREATE INDEX IF NOT EXISTS idx_view_dedupe_playlist_time
  ON public.view_dedupe (playlist_id, bucket_start DESC)
  WHERE view_type = 'playlist_public';

CREATE INDEX IF NOT EXISTS idx_playlist_views_last_viewed
  ON public.playlist_views (playlist_id, last_viewed_at DESC);

-- RPC-style helper for backend snapshot generation
CREATE OR REPLACE FUNCTION public.trending_now_candidates(limit_count integer DEFAULT 40)
RETURNS TABLE (
  playlist_id uuid,
  external_id text,
  title text,
  cover_url text,
  image_url text,
  view_count bigint,
  quality_score numeric,
  validated boolean,
  last_refreshed_on timestamptz,
  dedup_views_7d bigint,
  playlist_views_7d bigint,
  recent_viewed_at timestamptz
) AS $$
  WITH recent_dedup AS (
    SELECT playlist_id, COUNT(*)::bigint AS dedup_views_7d
    FROM public.view_dedupe
    WHERE view_type = 'playlist_public'
      AND playlist_id IS NOT NULL
      AND bucket_start >= now() - interval '7 days'
    GROUP BY playlist_id
  ),
  recent_views AS (
    SELECT playlist_id,
           SUM(view_count)::bigint AS playlist_views_7d,
           MAX(last_viewed_at) AS recent_viewed_at
    FROM public.playlist_views
    WHERE last_viewed_at >= now() - interval '7 days'
    GROUP BY playlist_id
  ),
  base AS (
    SELECT
      p.id AS playlist_id,
      p.external_id,
      p.title,
      p.cover_url,
      p.cover_url AS image_url,
      p.view_count,
      p.quality_score,
      p.validated,
      p.last_refreshed_on,
      COALESCE(rd.dedup_views_7d, 0)::bigint AS dedup_views_7d,
      COALESCE(rv.playlist_views_7d, 0)::bigint AS playlist_views_7d,
      COALESCE(rv.recent_viewed_at, p.last_refreshed_on) AS recent_viewed_at
    FROM public.playlists p
    LEFT JOIN recent_dedup rd ON rd.playlist_id = p.id
    LEFT JOIN recent_views rv ON rv.playlist_id = p.id
    WHERE p.is_public IS NOT FALSE
      AND p.source = 'youtube'
      AND COALESCE(p.broken, false) = false
      AND COALESCE(p.is_empty, false) = false
  )
  SELECT
    b.playlist_id,
    b.external_id,
    b.title,
    b.cover_url,
    b.image_url,
    b.view_count,
    b.quality_score,
    b.validated,
    b.last_refreshed_on,
    b.dedup_views_7d,
    b.playlist_views_7d,
    b.recent_viewed_at
  FROM base b
  WHERE (b.dedup_views_7d > 0 OR b.playlist_views_7d > 0 OR COALESCE(b.view_count,0) > 0)
  ORDER BY (b.dedup_views_7d + b.playlist_views_7d) DESC, COALESCE(b.view_count, 0) DESC NULLS LAST
  LIMIT COALESCE(limit_count, 40);
$$ LANGUAGE sql VOLATILE;

GRANT EXECUTE ON FUNCTION public.trending_now_candidates(integer) TO service_role;

COMMIT;
