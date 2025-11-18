-- Align existing likes table to support playlist likes safely
-- This migration is idempotent and adjusts common legacy shapes

BEGIN;

-- 1) Ensure required columns exist
ALTER TABLE public.likes ADD COLUMN IF NOT EXISTS id uuid;
ALTER TABLE public.likes ALTER COLUMN id SET DEFAULT gen_random_uuid();
ALTER TABLE public.likes ADD COLUMN IF NOT EXISTS playlist_id uuid REFERENCES public.playlists(id) ON DELETE CASCADE;
ALTER TABLE public.likes ADD COLUMN IF NOT EXISTS created_at timestamptz DEFAULT now();
-- Keep liked_at sync handled by a separate migration file already present

-- 2) Allow NULL track_id (so a row can target a playlist)
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'likes'
      AND column_name = 'track_id'
      AND is_nullable = 'NO'
  ) THEN
    ALTER TABLE public.likes ALTER COLUMN track_id DROP NOT NULL;
  END IF;
END$$;

-- 3) Drop legacy primary key on (user_id, track_id) if present
ALTER TABLE public.likes DROP CONSTRAINT IF EXISTS likes_pkey;

-- 4) Set primary key on id (if not already)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint c
    JOIN pg_class t ON c.conrelid = t.oid
    JOIN pg_namespace n ON n.oid = t.relnamespace
    WHERE c.contype = 'p' AND t.relname = 'likes' AND n.nspname = 'public'
  ) THEN
    ALTER TABLE public.likes ADD PRIMARY KEY (id);
  END IF;
END$$;

-- 5) Enforce exactly one target (track OR playlist)
ALTER TABLE public.likes DROP CONSTRAINT IF EXISTS like_target_check;
ALTER TABLE public.likes
  ADD CONSTRAINT like_target_check
  CHECK ((track_id IS NOT NULL) <> (playlist_id IS NOT NULL));

-- 6) Prevent duplicates using unique partial indexes (idempotent)
CREATE UNIQUE INDEX IF NOT EXISTS likes_user_track_unique
  ON public.likes(user_id, track_id)
  WHERE track_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS likes_user_playlist_unique
  ON public.likes(user_id, playlist_id)
  WHERE playlist_id IS NOT NULL;

-- 7) Helpful general indexes (idempotent)
CREATE INDEX IF NOT EXISTS idx_likes_user_id ON public.likes(user_id);
CREATE INDEX IF NOT EXISTS idx_likes_track_id ON public.likes(track_id);
CREATE INDEX IF NOT EXISTS idx_likes_playlist_id ON public.likes(playlist_id);

-- 8) Ensure RLS is enabled and policies accommodate both targets
ALTER TABLE public.likes ENABLE ROW LEVEL SECURITY;

-- Read-all policy (idempotent safe create via wrapper)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'likes' AND policyname = 'Users can view all likes'
  ) THEN
    CREATE POLICY "Users can view all likes" ON public.likes FOR SELECT USING (true);
  END IF;
END$$;

-- Insert-own policy
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'likes' AND policyname = 'Users can insert their own likes'
  ) THEN
    CREATE POLICY "Users can insert their own likes" ON public.likes FOR INSERT WITH CHECK (auth.uid() = user_id);
  END IF;
END$$;

-- Delete-own policy
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'likes' AND policyname = 'Users can delete their own likes'
  ) THEN
    CREATE POLICY "Users can delete their own likes" ON public.likes FOR DELETE USING (auth.uid() = user_id);
  END IF;
END$$;

COMMIT;
