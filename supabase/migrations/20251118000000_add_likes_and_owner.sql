-- Add owner_id to playlists table
ALTER TABLE playlists 
ADD COLUMN owner_id uuid REFERENCES users(id) ON DELETE CASCADE;

-- Create index for faster queries
CREATE INDEX idx_playlists_owner_id ON playlists(owner_id);

-- Create likes table
CREATE TABLE IF NOT EXISTS likes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  track_id uuid REFERENCES tracks(id) ON DELETE CASCADE,
  playlist_id uuid REFERENCES playlists(id) ON DELETE CASCADE,
  created_at timestamptz DEFAULT now(),
  
  -- Ensure user can like either a track OR a playlist, not both
  CONSTRAINT like_target_check CHECK (
    (track_id IS NOT NULL AND playlist_id IS NULL) OR 
    (track_id IS NULL AND playlist_id IS NOT NULL)
  ),
  
  -- Prevent duplicate likes
  CONSTRAINT unique_track_like UNIQUE (user_id, track_id),
  CONSTRAINT unique_playlist_like UNIQUE (user_id, playlist_id)
);

-- Create indexes for faster queries
CREATE INDEX idx_likes_user_id ON likes(user_id);
CREATE INDEX idx_likes_track_id ON likes(track_id);
CREATE INDEX idx_likes_playlist_id ON likes(playlist_id);

-- Enable Row Level Security
ALTER TABLE likes ENABLE ROW LEVEL SECURITY;

-- RLS Policies for likes table
-- Users can read all likes
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

-- Update playlists RLS policies to include owner_id
-- Note: This assumes existing policies exist and may need adjustment
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
