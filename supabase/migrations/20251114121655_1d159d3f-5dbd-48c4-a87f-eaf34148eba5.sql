-- Create playlist_tracks junction table if it doesn't exist
CREATE TABLE IF NOT EXISTS public.playlist_tracks (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  playlist_id UUID NOT NULL REFERENCES public.playlists(id) ON DELETE CASCADE,
  track_id UUID NOT NULL REFERENCES public.tracks(id) ON DELETE CASCADE,
  position INTEGER NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  UNIQUE(playlist_id, track_id),
  UNIQUE(playlist_id, position)
);

-- Add cover_url column to playlists if it doesn't exist
DO $$ 
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'playlists' AND column_name = 'cover_url'
  ) THEN
    ALTER TABLE public.playlists ADD COLUMN cover_url TEXT;
  END IF;
END $$;

-- Add external_id column to tracks if it doesn't exist
DO $$ 
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'tracks' AND column_name = 'external_id'
  ) THEN
    ALTER TABLE public.tracks ADD COLUMN external_id TEXT;
  END IF;
END $$;

-- Add cover_url column to tracks if it doesn't exist
DO $$ 
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'tracks' AND column_name = 'cover_url'
  ) THEN
    ALTER TABLE public.tracks ADD COLUMN cover_url TEXT;
  END IF;
END $$;

-- Enable RLS on playlist_tracks
ALTER TABLE public.playlist_tracks ENABLE ROW LEVEL SECURITY;

-- RLS Policy for playlist_tracks (public read)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies 
    WHERE tablename = 'playlist_tracks' AND policyname = 'Anyone can view playlist_tracks'
  ) THEN
    CREATE POLICY "Anyone can view playlist_tracks"
      ON public.playlist_tracks FOR SELECT
      USING (true);
  END IF;
END $$;

-- Create indexes for better performance
CREATE INDEX IF NOT EXISTS idx_playlist_tracks_playlist_id ON public.playlist_tracks(playlist_id);
CREATE INDEX IF NOT EXISTS idx_playlist_tracks_track_id ON public.playlist_tracks(track_id);
CREATE INDEX IF NOT EXISTS idx_playlist_tracks_position ON public.playlist_tracks(playlist_id, position);