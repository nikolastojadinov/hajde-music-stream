-- Fix tracks table UNIQUE constraint on external_id
-- This migration ensures the constraint exists and is properly named

-- Drop any existing index/constraint with the expected name (idempotent)
DO $$
BEGIN
  -- Check if constraint exists
  IF EXISTS (
    SELECT 1 FROM pg_constraint 
    WHERE conname = 'uq_tracks_external_id'
  ) THEN
    -- Constraint already exists, skip
    RAISE NOTICE 'Constraint uq_tracks_external_id already exists';
  ELSE
    -- Create the UNIQUE constraint
    ALTER TABLE public.tracks 
      ADD CONSTRAINT uq_tracks_external_id UNIQUE (external_id);
    RAISE NOTICE 'Created constraint uq_tracks_external_id';
  END IF;
END $$;

-- Create a partial index for non-NULL values (optimization)
CREATE UNIQUE INDEX IF NOT EXISTS uq_tracks_external_id_idx 
  ON public.tracks (external_id) 
  WHERE external_id IS NOT NULL;

-- Add helpful comments
COMMENT ON CONSTRAINT uq_tracks_external_id ON public.tracks IS 
  'Ensures each YouTube video (external_id) appears only once in tracks table. Tracks are shared across playlists via playlist_tracks junction table.';
