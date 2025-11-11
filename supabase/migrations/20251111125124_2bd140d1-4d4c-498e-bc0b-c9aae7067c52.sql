-- Add image_url column to tracks table
ALTER TABLE public.tracks ADD COLUMN IF NOT EXISTS image_url TEXT;

-- Add default YouTube thumbnail URL pattern for existing tracks
UPDATE public.tracks 
SET image_url = CONCAT('https://img.youtube.com/vi/', youtube_id, '/hqdefault.jpg')
WHERE image_url IS NULL;