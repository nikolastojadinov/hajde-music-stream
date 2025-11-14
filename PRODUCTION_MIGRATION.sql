-- PRODUKCIONA MIGRACIJA
-- Kopiraj ovaj SQL i pokreni ga u Supabase Dashboard > SQL Editor

-- Dodaj image_url kolonu u playlists tabelu ako ne postoji
ALTER TABLE public.playlists ADD COLUMN IF NOT EXISTS image_url TEXT;

-- Dodaj image_url kolonu u tracks tabelu ako ne postoji  
ALTER TABLE public.tracks ADD COLUMN IF NOT EXISTS image_url TEXT;

-- Ažuriraj postojeće tracks da imaju YouTube thumbnail
UPDATE public.tracks 
SET image_url = CONCAT('https://img.youtube.com/vi/', youtube_id, '/hqdefault.jpg')
WHERE image_url IS NULL AND youtube_id IS NOT NULL;

-- Postavi default placeholder za playliste
UPDATE public.playlists 
SET image_url = '/placeholder.svg'
WHERE image_url IS NULL;

-- Proveri da li je sve OK
SELECT 'Playlists updated:' as status, COUNT(*) as count FROM public.playlists WHERE image_url IS NOT NULL
UNION ALL
SELECT 'Tracks updated:' as status, COUNT(*) as count FROM public.tracks WHERE image_url IS NOT NULL;
