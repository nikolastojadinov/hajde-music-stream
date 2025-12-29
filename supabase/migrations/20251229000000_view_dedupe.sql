-- Deduplication guard for view writes (track views + public playlist views)
-- Prevents duplicate writes within 10-second buckets per user/type/resource

BEGIN;

CREATE TABLE IF NOT EXISTS public.view_dedupe (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NULL,
  view_type text NOT NULL CHECK (view_type IN ('track', 'playlist_public')),
  track_id uuid NULL,
  playlist_id uuid NULL,
  bucket_start timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Unique key across user/type/resource/time bucket
CREATE UNIQUE INDEX IF NOT EXISTS idx_view_dedupe_unique
  ON public.view_dedupe (
    view_type,
    COALESCE(user_id, '00000000-0000-0000-0000-000000000000'::uuid),
    COALESCE(track_id, '00000000-0000-0000-0000-000000000000'::uuid),
    COALESCE(playlist_id, '00000000-0000-0000-0000-000000000000'::uuid),
    bucket_start
  );

COMMENT ON TABLE public.view_dedupe IS 'Guards duplicate view writes within 10-second buckets';
COMMENT ON COLUMN public.view_dedupe.view_type IS 'track | playlist_public';
COMMENT ON COLUMN public.view_dedupe.bucket_start IS 'Start of 10-second bucket (rounded down)';

COMMIT;
