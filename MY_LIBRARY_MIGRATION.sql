-- ============================================
-- MY LIBRARY SYSTEM - COMPLETE SQL MIGRATION
-- ============================================
-- This script ensures all required columns and indexes exist
-- for the complete My Library functionality including:
-- - User-created playlists
-- - Liked playlists
-- - Liked songs/tracks
-- ============================================

-- STEP 1: Ensure playlists table has owner_id
-- This allows tracking who created each playlist
ALTER TABLE playlists 
ADD COLUMN IF NOT EXISTS owner_id uuid REFERENCES users(id) ON DELETE CASCADE;

-- Create index for faster queries on owner_id
CREATE INDEX IF NOT EXISTS idx_playlists_owner_id ON playlists(owner_id);

-- STEP 2: Ensure likes table exists with all required columns
CREATE TABLE IF NOT EXISTS likes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  track_id uuid REFERENCES tracks(id) ON DELETE CASCADE,
  playlist_id uuid REFERENCES playlists(id) ON DELETE CASCADE,
  created_at timestamptz DEFAULT now(),
  liked_at timestamptz DEFAULT now(),
  
  -- Ensure user can like either a track OR a playlist, not both
  CONSTRAINT like_target_check CHECK (
    (track_id IS NOT NULL AND playlist_id IS NULL) OR 
    (track_id IS NULL AND playlist_id IS NOT NULL)
  ),
  
  -- Prevent duplicate likes
  CONSTRAINT unique_track_like UNIQUE (user_id, track_id),
  CONSTRAINT unique_playlist_like UNIQUE (user_id, playlist_id)
);

-- STEP 3: Add liked_at column if it doesn't exist (for compatibility)
ALTER TABLE likes ADD COLUMN IF NOT EXISTS liked_at timestamptz;

-- Update existing rows to copy created_at to liked_at
UPDATE likes SET liked_at = created_at WHERE liked_at IS NULL;

-- Set default for new rows
ALTER TABLE likes ALTER COLUMN liked_at SET DEFAULT now();

-- STEP 4: Create trigger to keep created_at and liked_at in sync
CREATE OR REPLACE FUNCTION sync_liked_at()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.liked_at IS NULL THEN
    NEW.liked_at := NEW.created_at;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS set_liked_at_on_insert ON likes;
CREATE TRIGGER set_liked_at_on_insert
  BEFORE INSERT ON likes
  FOR EACH ROW
  EXECUTE FUNCTION sync_liked_at();

-- STEP 5: Create indexes for faster queries on likes table
CREATE INDEX IF NOT EXISTS idx_likes_user_id ON likes(user_id);
CREATE INDEX IF NOT EXISTS idx_likes_track_id ON likes(track_id);
CREATE INDEX IF NOT EXISTS idx_likes_playlist_id ON likes(playlist_id);

-- STEP 6: Enable Row Level Security
ALTER TABLE likes ENABLE ROW LEVEL SECURITY;

-- STEP 7: Drop existing policies if they exist (to avoid conflicts)
DROP POLICY IF EXISTS "Users can view all likes" ON likes;
DROP POLICY IF EXISTS "Users can insert their own likes" ON likes;
DROP POLICY IF EXISTS "Users can delete their own likes" ON likes;

-- STEP 8: Create RLS Policies for likes table
-- Users can read all likes (to see like counts, etc.)
CREATE POLICY "Users can view all likes"
  ON likes FOR SELECT
  USING (true);

-- Users can only insert their own likes
CREATE POLICY "Users can insert their own likes"
  ON likes FOR INSERT
  WITH CHECK (auth.uid() = user_id);

-- Users can only delete their own likes
CREATE POLICY "Users can delete their own likes"
  ON likes FOR DELETE
  USING (auth.uid() = user_id);

-- STEP 9: Update playlists RLS policies
DROP POLICY IF EXISTS "Users can view all playlists" ON playlists;
DROP POLICY IF EXISTS "Users can insert their own playlists" ON playlists;
DROP POLICY IF EXISTS "Users can update their own playlists" ON playlists;
DROP POLICY IF EXISTS "Users can delete their own playlists" ON playlists;

CREATE POLICY "Users can view all playlists"
  ON playlists FOR SELECT
  USING (true);

CREATE POLICY "Users can insert their own playlists"
  ON playlists FOR INSERT
  WITH CHECK (auth.uid() = owner_id);

CREATE POLICY "Users can update their own playlists"
  ON playlists FOR UPDATE
  USING (auth.uid() = owner_id);

CREATE POLICY "Users can delete their own playlists"
  ON playlists FOR DELETE
  USING (auth.uid() = owner_id);

-- ============================================
-- VERIFICATION QUERIES
-- ============================================
-- Run these to verify the migration worked:
--
-- 1. Check playlists table structure:
-- SELECT column_name, data_type, is_nullable 
-- FROM information_schema.columns 
-- WHERE table_name = 'playlists' AND column_name = 'owner_id';
--
-- 2. Check likes table structure:
-- SELECT column_name, data_type, is_nullable 
-- FROM information_schema.columns 
-- WHERE table_name = 'likes';
--
-- 3. Check indexes:
-- SELECT indexname, tablename 
-- FROM pg_indexes 
-- WHERE tablename IN ('playlists', 'likes');
--
-- 4. Check RLS policies:
-- SELECT tablename, policyname, cmd 
-- FROM pg_policies 
-- WHERE tablename IN ('playlists', 'likes');
-- ============================================
