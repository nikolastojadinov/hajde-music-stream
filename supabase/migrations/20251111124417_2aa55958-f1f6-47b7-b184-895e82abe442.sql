-- Create playlists table
CREATE TABLE public.playlists (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  title TEXT NOT NULL,
  description TEXT,
  category TEXT,
  image_url TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Create tracks table
CREATE TABLE public.tracks (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  title TEXT NOT NULL,
  artist TEXT NOT NULL,
  duration INTEGER, -- duration in seconds
  youtube_id TEXT NOT NULL,
  playlist_id UUID REFERENCES public.playlists(id) ON DELETE CASCADE,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable Row Level Security
ALTER TABLE public.playlists ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tracks ENABLE ROW LEVEL SECURITY;

-- Create policies for public read access
CREATE POLICY "Anyone can view playlists" 
ON public.playlists 
FOR SELECT 
USING (true);

CREATE POLICY "Anyone can view tracks" 
ON public.tracks 
FOR SELECT 
USING (true);

-- Insert rock playlists
INSERT INTO public.playlists (title, description, category) VALUES
('Rock Classics', 'Besmrtne rok pesme', 'rock'),
('Hard Rock Anthems', 'Najjači hard rock hitovi', 'rock'),
('Alternative Rock', 'Moderna alternativna scena', 'rock'),
('Classic Rock Legends', 'Legende klasičnog roka', 'rock'),
('Rock Ballads', 'Emotivne rok balade', 'rock'),
('90s Rock Hits', 'Najbolje iz 90-ih', 'rock');