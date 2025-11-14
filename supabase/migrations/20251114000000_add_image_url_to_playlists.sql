-- Add image_url column to playlists table if it doesn't exist
ALTER TABLE public.playlists ADD COLUMN IF NOT EXISTS image_url TEXT;

-- Update existing playlists to have default placeholder or null
-- (optional - can be removed if not needed)
UPDATE public.playlists 
SET image_url = '/placeholder.svg'
WHERE image_url IS NULL;
