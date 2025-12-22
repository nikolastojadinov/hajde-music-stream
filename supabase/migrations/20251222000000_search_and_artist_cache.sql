-- Safe migration: dedupe existing suggest_entries, then add indexes/columns and supporting cache structures.
-- WARNING: This schema is for context only and is not meant to be run blindly in other environments.

BEGIN;

-- Ensure table exists with required columns
CREATE TABLE IF NOT EXISTS public.suggest_entries (
  id BIGSERIAL PRIMARY KEY,
  source text,
  query text NOT NULL,
  normalized_query text,
  results jsonb NOT NULL,
  ttl_seconds integer,
  meta jsonb NOT NULL DEFAULT '{}'::jsonb,
  ts timestamptz NOT NULL DEFAULT now()
);

-- Backfill columns if the table pre-exists
ALTER TABLE public.suggest_entries
  ALTER COLUMN ts SET DEFAULT now();

ALTER TABLE public.suggest_entries
  ADD COLUMN IF NOT EXISTS normalized_query text,
  ADD COLUMN IF NOT EXISTS meta jsonb DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS ttl_seconds integer;

-- Dedupe existing rows by keeping the newest per query
DELETE FROM public.suggest_entries se
WHERE se.id NOT IN (
  SELECT id FROM (
    SELECT id,
           ROW_NUMBER() OVER (PARTITION BY query ORDER BY ts DESC NULLS LAST, id DESC) AS rn
    FROM public.suggest_entries
  ) dedup
  WHERE dedup.rn = 1
);

-- Unique index after dedupe
DROP INDEX IF EXISTS suggest_entries_query_unique;
CREATE UNIQUE INDEX IF NOT EXISTS suggest_entries_query_unique
  ON public.suggest_entries(query);

CREATE INDEX IF NOT EXISTS idx_suggest_query_ts
  ON public.suggest_entries(query, ts DESC);

CREATE INDEX IF NOT EXISTS idx_suggest_normalized_query_ts
  ON public.suggest_entries(normalized_query, ts DESC);

-- Artist page cache entries
CREATE TABLE IF NOT EXISTS public.artist_cache_entries (
  artist_key text PRIMARY KEY,
  payload jsonb NOT NULL,
  etag text,
  ts timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_artist_cache_ts
  ON public.artist_cache_entries(ts DESC);

-- Performance indexes for artist/playlist lookups
CREATE INDEX IF NOT EXISTS idx_tracks_artist ON public.tracks(artist);
CREATE INDEX IF NOT EXISTS idx_tracks_artist_channel ON public.tracks(artist_channel_id);
CREATE INDEX IF NOT EXISTS idx_playlist_tracks_track ON public.playlist_tracks(track_id);
CREATE INDEX IF NOT EXISTS idx_playlist_tracks_playlist ON public.playlist_tracks(playlist_id);
CREATE INDEX IF NOT EXISTS idx_playlists_channel ON public.playlists(channel_id);
CREATE INDEX IF NOT EXISTS idx_playlists_title ON public.playlists(title);
CREATE INDEX IF NOT EXISTS idx_playlists_country ON public.playlists(country);

-- Atomic playlist view upsert to avoid duplicate key errors
CREATE OR REPLACE FUNCTION public.upsert_playlist_view(p_playlist_id uuid, p_user_id uuid)
RETURNS public.playlist_views
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  result public.playlist_views;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'upsert_playlist_view restricted to service_role';
  END IF;

  INSERT INTO public.playlist_views (playlist_id, user_id, view_count, viewed_at, last_viewed_at)
  VALUES (p_playlist_id, p_user_id, 1, now(), now())
  ON CONFLICT (playlist_id, user_id) DO UPDATE
    SET view_count = public.playlist_views.view_count + 1,
        last_viewed_at = EXCLUDED.last_viewed_at
  RETURNING * INTO result;

  RETURN result;
END;
$$;

GRANT EXECUTE ON FUNCTION public.upsert_playlist_view(uuid, uuid) TO service_role;

COMMIT;
