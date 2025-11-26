-- Migration to add playlist refresh metadata fields
-- This supports efficient ETag-based refresh and delta sync

-- Add missing columns to playlists table
ALTER TABLE public.playlists 
  ADD COLUMN IF NOT EXISTS external_id TEXT,
  ADD COLUMN IF NOT EXISTS fetched_on TIMESTAMP WITH TIME ZONE,
  ADD COLUMN IF NOT EXISTS last_refreshed_on TIMESTAMP WITH TIME ZONE,
  ADD COLUMN IF NOT EXISTS last_etag TEXT,
  ADD COLUMN IF NOT EXISTS item_count INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS view_count INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS region TEXT,
  ADD COLUMN IF NOT EXISTS is_public BOOLEAN DEFAULT true;

-- Add missing columns to tracks table  
ALTER TABLE public.tracks
  ADD COLUMN IF NOT EXISTS sync_status TEXT DEFAULT 'active' CHECK (sync_status IN ('active', 'deleted', 'pending')),
  ADD COLUMN IF NOT EXISTS last_synced_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  ADD COLUMN IF NOT EXISTS quality_score INTEGER,
  ADD COLUMN IF NOT EXISTS region TEXT,
  ADD COLUMN IF NOT EXISTS cover_url TEXT,
  ADD COLUMN IF NOT EXISTS image_url TEXT;

-- Update category column on tracks to match playlists
ALTER TABLE public.tracks
  ADD COLUMN IF NOT EXISTS category TEXT;

-- Create indexes for efficient refresh queries
CREATE INDEX IF NOT EXISTS idx_playlists_last_refreshed_on 
  ON public.playlists (last_refreshed_on NULLS FIRST);

CREATE INDEX IF NOT EXISTS idx_playlists_fetched_on 
  ON public.playlists (fetched_on);

CREATE INDEX IF NOT EXISTS idx_playlists_external_id 
  ON public.playlists (external_id) WHERE external_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_tracks_sync_status 
  ON public.tracks (sync_status);

CREATE INDEX IF NOT EXISTS idx_tracks_playlist_youtube 
  ON public.tracks (playlist_id, youtube_id);

CREATE INDEX IF NOT EXISTS idx_tracks_external_id 
  ON public.tracks (external_id) WHERE external_id IS NOT NULL;

-- Update existing tracks to have active sync_status if NULL
UPDATE public.tracks 
SET sync_status = 'active' 
WHERE sync_status IS NULL;

-- Add comment documenting the refresh strategy
COMMENT ON COLUMN public.playlists.last_etag IS 'ETag from YouTube API for efficient conditional requests (HTTP 304)';
COMMENT ON COLUMN public.playlists.last_refreshed_on IS 'Timestamp of last successful refresh, used for 30-day cycle scheduling';
COMMENT ON COLUMN public.playlists.external_id IS 'YouTube playlist ID for API calls';
COMMENT ON COLUMN public.tracks.sync_status IS 'Track lifecycle: active (in playlist), deleted (removed from playlist), pending (being synced)';
COMMENT ON COLUMN public.tracks.last_synced_at IS 'Timestamp of last sync operation for this track';
