-- Add view count and last viewed timestamp to playlist_views table
-- This enables "Jump back in" personalized recommendations

BEGIN;

-- Add columns for tracking view count and last access time
ALTER TABLE public.playlist_views
  ADD COLUMN IF NOT EXISTS view_count INTEGER DEFAULT 1,
  ADD COLUMN IF NOT EXISTS last_viewed_at TIMESTAMPTZ DEFAULT now();

-- Update existing rows to have default values
UPDATE public.playlist_views
SET 
  view_count = 1,
  last_viewed_at = viewed_at
WHERE view_count IS NULL OR last_viewed_at IS NULL;

-- Create index for efficient "most viewed" queries
CREATE INDEX IF NOT EXISTS idx_playlist_views_user_count
  ON public.playlist_views (user_id, view_count DESC, last_viewed_at DESC);

-- Add helpful comments
COMMENT ON COLUMN public.playlist_views.view_count IS 'Number of times user opened this playlist';
COMMENT ON COLUMN public.playlist_views.last_viewed_at IS 'Last time user opened this playlist';

COMMIT;
