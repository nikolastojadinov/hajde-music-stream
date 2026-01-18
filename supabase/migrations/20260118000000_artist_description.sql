-- Add artist description column for artist bios
ALTER TABLE artists
  ADD COLUMN IF NOT EXISTS artist_description TEXT;
