-- Junction tables and track flags for search ingestion flows
BEGIN;

-- Artist to Track (many-to-many)
CREATE TABLE IF NOT EXISTS public.artist_tracks (
  artist_key text NOT NULL REFERENCES public.artists(artist_key) ON DELETE CASCADE,
  track_id uuid NOT NULL REFERENCES public.tracks(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (artist_key, track_id)
);

CREATE INDEX IF NOT EXISTS idx_artist_tracks_artist ON public.artist_tracks(artist_key);
CREATE INDEX IF NOT EXISTS idx_artist_tracks_track ON public.artist_tracks(track_id);

ALTER TABLE public.artist_tracks ENABLE ROW LEVEL SECURITY;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'artist_tracks' AND policyname = 'Anyone can view artist_tracks'
  ) THEN
    CREATE POLICY "Anyone can view artist_tracks" ON public.artist_tracks FOR SELECT USING (true);
  END IF;
END;
$$;

-- Artist to Album (many-to-many)
CREATE TABLE IF NOT EXISTS public.artist_albums (
  artist_key text NOT NULL REFERENCES public.artists(artist_key) ON DELETE CASCADE,
  album_id uuid NOT NULL REFERENCES public.albums(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (artist_key, album_id)
);

CREATE INDEX IF NOT EXISTS idx_artist_albums_artist ON public.artist_albums(artist_key);
CREATE INDEX IF NOT EXISTS idx_artist_albums_album ON public.artist_albums(album_id);

ALTER TABLE public.artist_albums ENABLE ROW LEVEL SECURITY;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'artist_albums' AND policyname = 'Anyone can view artist_albums'
  ) THEN
    CREATE POLICY "Anyone can view artist_albums" ON public.artist_albums FOR SELECT USING (true);
  END IF;
END;
$$;

-- Album to Track (many-to-many with ordering)
CREATE TABLE IF NOT EXISTS public.album_tracks (
  album_id uuid NOT NULL REFERENCES public.albums(id) ON DELETE CASCADE,
  track_id uuid NOT NULL REFERENCES public.tracks(id) ON DELETE CASCADE,
  position integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (album_id, track_id)
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_album_tracks_position ON public.album_tracks(album_id, position);
CREATE INDEX IF NOT EXISTS idx_album_tracks_album ON public.album_tracks(album_id);
CREATE INDEX IF NOT EXISTS idx_album_tracks_track ON public.album_tracks(track_id);

ALTER TABLE public.album_tracks ENABLE ROW LEVEL SECURITY;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'album_tracks' AND policyname = 'Anyone can view album_tracks'
  ) THEN
    CREATE POLICY "Anyone can view album_tracks" ON public.album_tracks FOR SELECT USING (true);
  END IF;
END;
$$;

-- Track flags for song/video distinction and explicit marker
ALTER TABLE public.tracks ADD COLUMN IF NOT EXISTS is_video boolean DEFAULT false;
ALTER TABLE public.tracks ADD COLUMN IF NOT EXISTS source text;
ALTER TABLE public.tracks ADD COLUMN IF NOT EXISTS is_explicit boolean;

-- Album type helper
ALTER TABLE public.albums ADD COLUMN IF NOT EXISTS album_type text;

COMMIT;
