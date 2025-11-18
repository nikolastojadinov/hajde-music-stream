-- ============================================
-- QUICK MIGRATION GUIDE
-- ============================================
-- Copy and paste this entire file into the Supabase SQL Editor and run it.
-- This will set up everything needed for the My Library system.
-- ============================================

-- 1. Add owner_id to playlists
ALTER TABLE playlists ADD COLUMN IF NOT EXISTS owner_id uuid REFERENCES users(id) ON DELETE CASCADE;
CREATE INDEX IF NOT EXISTS idx_playlists_owner_id ON playlists(owner_id);

-- 2. Ensure likes table exists
CREATE TABLE IF NOT EXISTS likes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  track_id uuid REFERENCES tracks(id) ON DELETE CASCADE,
  playlist_id uuid REFERENCES playlists(id) ON DELETE CASCADE,
  created_at timestamptz DEFAULT now(),
  liked_at timestamptz DEFAULT now(),
  CONSTRAINT like_target_check CHECK (
    (track_id IS NOT NULL AND playlist_id IS NULL) OR 
    (track_id IS NULL AND playlist_id IS NOT NULL)
  ),
  CONSTRAINT unique_track_like UNIQUE (user_id, track_id),
  CONSTRAINT unique_playlist_like UNIQUE (user_id, playlist_id)
);

-- 3. Add liked_at column for compatibility
ALTER TABLE likes ADD COLUMN IF NOT EXISTS liked_at timestamptz;
UPDATE likes SET liked_at = created_at WHERE liked_at IS NULL;
ALTER TABLE likes ALTER COLUMN liked_at SET DEFAULT now();

-- 4. Create sync trigger
CREATE OR REPLACE FUNCTION sync_liked_at() RETURNS TRIGGER AS $$
BEGIN
  IF NEW.liked_at IS NULL THEN NEW.liked_at := NEW.created_at; END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS set_liked_at_on_insert ON likes;
CREATE TRIGGER set_liked_at_on_insert BEFORE INSERT ON likes
  FOR EACH ROW EXECUTE FUNCTION sync_liked_at();

-- 5. Create indexes
CREATE INDEX IF NOT EXISTS idx_likes_user_id ON likes(user_id);
CREATE INDEX IF NOT EXISTS idx_likes_track_id ON likes(track_id);
CREATE INDEX IF NOT EXISTS idx_likes_playlist_id ON likes(playlist_id);

-- 6. Enable RLS
ALTER TABLE likes ENABLE ROW LEVEL SECURITY;

-- 7. Create RLS policies for likes
DROP POLICY IF EXISTS "Users can view all likes" ON likes;
DROP POLICY IF EXISTS "Users can insert their own likes" ON likes;
DROP POLICY IF EXISTS "Users can delete their own likes" ON likes;

CREATE POLICY "Users can view all likes" ON likes FOR SELECT USING (true);
CREATE POLICY "Users can insert their own likes" ON likes FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can delete their own likes" ON likes FOR DELETE USING (auth.uid() = user_id);

-- 8. Update playlists RLS policies
DROP POLICY IF EXISTS "Users can view all playlists" ON playlists;
DROP POLICY IF EXISTS "Users can insert their own playlists" ON playlists;
DROP POLICY IF EXISTS "Users can update their own playlists" ON playlists;
DROP POLICY IF EXISTS "Users can delete their own playlists" ON playlists;

CREATE POLICY "Users can view all playlists" ON playlists FOR SELECT USING (true);
CREATE POLICY "Users can insert their own playlists" ON playlists FOR INSERT WITH CHECK (auth.uid() = owner_id);
CREATE POLICY "Users can update their own playlists" ON playlists FOR UPDATE USING (auth.uid() = owner_id);
CREATE POLICY "Users can delete their own playlists" ON playlists FOR DELETE USING (auth.uid() = owner_id);

-- ✅ DONE! Your My Library system is now ready to use.
