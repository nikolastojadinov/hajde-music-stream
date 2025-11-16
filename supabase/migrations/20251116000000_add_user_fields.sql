-- Add missing columns to users table for full Pi integration
ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS wallet text,
  ADD COLUMN IF NOT EXISTS user_consent boolean DEFAULT true,
  ADD COLUMN IF NOT EXISTS premium_until timestamptz,
  ADD COLUMN IF NOT EXISTS spotify_connected boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS spotify_expires_at timestamptz,
  ADD COLUMN IF NOT EXISTS country text,
  ADD COLUMN IF NOT EXISTS language text;

-- Remove updated_at column if it exists (not needed per requirements)
ALTER TABLE public.users DROP COLUMN IF EXISTS updated_at;
