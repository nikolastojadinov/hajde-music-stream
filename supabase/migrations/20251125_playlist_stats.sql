-- Playlist Views statistics table
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'playlist_views'
  ) THEN
    CREATE TABLE public.playlist_views (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      playlist_id UUID NOT NULL,
      viewed_at TIMESTAMPTZ DEFAULT now()
    );
  END IF;
END $$;

-- Index on playlist_id for quick stats queries
CREATE INDEX IF NOT EXISTS playlist_views_playlist_idx
  ON public.playlist_views (playlist_id);
