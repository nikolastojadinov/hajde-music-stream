BEGIN;

-- Ensure playlist_views has user_id column for unique user tracking
ALTER TABLE public.playlist_views
  ADD COLUMN IF NOT EXISTS user_id uuid;

-- Drop legacy duplicates without user tracking (safe reset)
DELETE FROM public.playlist_views WHERE user_id IS NULL;

ALTER TABLE public.playlist_views
  ALTER COLUMN user_id SET NOT NULL;

-- Enforce uniqueness per playlist/user pair
DROP INDEX IF EXISTS playlist_views_playlist_user_unique;
CREATE UNIQUE INDEX IF NOT EXISTS playlist_views_playlist_user_unique
  ON public.playlist_views (playlist_id, user_id);

CREATE INDEX IF NOT EXISTS playlist_views_user_idx
  ON public.playlist_views (user_id);

ALTER TABLE public.playlist_views ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Service role manages playlist views" ON public.playlist_views;
CREATE POLICY "Service role manages playlist views"
ON public.playlist_views
FOR ALL
USING (auth.role() = 'service_role')
WITH CHECK (auth.role() = 'service_role');

-- Playlist stats view (likes + unique views)
DROP VIEW IF EXISTS public.playlist_stats;
CREATE VIEW public.playlist_stats
WITH (security_invoker = true)
AS
WITH view_counts AS (
  SELECT playlist_id, COUNT(DISTINCT user_id) AS public_view_count
  FROM public.playlist_views
  GROUP BY playlist_id
),
like_counts AS (
  SELECT playlist_id, COUNT(*) AS public_like_count
  FROM public.playlist_likes
  GROUP BY playlist_id
)
SELECT
  COALESCE(view_counts.playlist_id, like_counts.playlist_id) AS playlist_id,
  COALESCE(view_counts.public_view_count, 0) AS public_view_count,
  COALESCE(like_counts.public_like_count, 0) AS public_like_count
FROM view_counts
FULL OUTER JOIN like_counts USING (playlist_id);

GRANT SELECT ON public.playlist_stats TO anon, authenticated;

COMMIT;
