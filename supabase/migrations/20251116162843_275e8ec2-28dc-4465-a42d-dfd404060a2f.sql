-- Add premium_until column to users table
ALTER TABLE public.users ADD COLUMN premium_until timestamptz;