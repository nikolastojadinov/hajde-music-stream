-- Innertube decoder foundational schema + ingestion RPC
-- Safe to re-run; uses IF NOT EXISTS guards.

BEGIN;

-- Canonical artists table
CREATE TABLE IF NOT EXISTS public.artists (
  artist_key text PRIMARY KEY,
  display_name text NOT NULL,
  normalized_name text NOT NULL,
  youtube_channel_id text UNIQUE,
  subscriber_count bigint,
  view_count bigint,
  thumbnails jsonb,
  country text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Canonical albums table
CREATE TABLE IF NOT EXISTS public.albums (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  external_id text NOT NULL UNIQUE,
  title text NOT NULL,
  artist_key text REFERENCES public.artists(artist_key),
  thumbnail_url text,
  release_date date,
  track_count integer,
  total_duration_seconds integer,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Innertube raw payload ledger
CREATE TABLE IF NOT EXISTS public.innertube_raw_payloads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_type text NOT NULL,
  request_key text,
  payload jsonb NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','processed','error')),
  error_message text,
  processed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_innertube_raw_pending ON public.innertube_raw_payloads (status, created_at);

-- Tracks table shape adjustments for decoder inputs
ALTER TABLE public.tracks ADD COLUMN IF NOT EXISTS artist_key text;
ALTER TABLE public.tracks ADD COLUMN IF NOT EXISTS artist_channel_id text;
ALTER TABLE public.tracks ADD COLUMN IF NOT EXISTS album_id uuid REFERENCES public.albums(id);
ALTER TABLE public.tracks ADD COLUMN IF NOT EXISTS published_at timestamptz;
ALTER TABLE public.tracks ADD COLUMN IF NOT EXISTS last_updated_at timestamptz DEFAULT now();

-- Playlists table shape adjustments
ALTER TABLE public.playlists ADD COLUMN IF NOT EXISTS external_id text;
ALTER TABLE public.playlists ADD COLUMN IF NOT EXISTS channel_id text;
ALTER TABLE public.playlists ADD COLUMN IF NOT EXISTS country text;
ALTER TABLE public.playlists ADD COLUMN IF NOT EXISTS region text;
ALTER TABLE public.playlists ADD COLUMN IF NOT EXISTS broken boolean;
ALTER TABLE public.playlists ADD COLUMN IF NOT EXISTS unstable boolean;
ALTER TABLE public.playlists ADD COLUMN IF NOT EXISTS is_empty boolean;
ALTER TABLE public.playlists ADD COLUMN IF NOT EXISTS validated boolean;
ALTER TABLE public.playlists ADD COLUMN IF NOT EXISTS validated_on timestamptz;
ALTER TABLE public.playlists ADD COLUMN IF NOT EXISTS last_etag text;
ALTER TABLE public.playlists ADD COLUMN IF NOT EXISTS item_count integer;

-- Identity constraints
CREATE UNIQUE INDEX IF NOT EXISTS uq_tracks_youtube_id ON public.tracks(youtube_id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_playlists_external_id ON public.playlists(external_id) WHERE external_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_albums_external_id ON public.albums(external_id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_artists_channel_id ON public.artists(youtube_channel_id) WHERE youtube_channel_id IS NOT NULL;

-- Ingestion RPC: processes one payload transactionally
DROP FUNCTION IF EXISTS public.ingest_innertube_entities(uuid, jsonb, jsonb, jsonb, jsonb, jsonb);

CREATE OR REPLACE FUNCTION public.ingest_innertube_entities(
  p_payload_id uuid,
  p_artists jsonb,
  p_albums jsonb,
  p_tracks jsonb,
  p_playlists jsonb,
  p_playlist_tracks jsonb
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'ingest_innertube_entities restricted to service_role';
  END IF;

  -- Lock the payload row to avoid concurrent processing
  PERFORM 1 FROM public.innertube_raw_payloads WHERE id = p_payload_id FOR UPDATE;

  -- Artists
  INSERT INTO public.artists (artist_key, display_name, normalized_name, youtube_channel_id, subscriber_count, view_count, thumbnails, country, updated_at)
  SELECT
    a.artist_key,
    COALESCE(a.display_name, a.artist_key),
    COALESCE(a.normalized_name, a.artist_key),
    NULLIF(a.youtube_channel_id, ''),
    a.subscriber_count,
    a.view_count,
    a.thumbnails,
    a.country,
    now()
  FROM jsonb_to_recordset(COALESCE(p_artists, '[]'::jsonb)) AS a(
    artist_key text,
    display_name text,
    normalized_name text,
    youtube_channel_id text,
    subscriber_count bigint,
    view_count bigint,
    thumbnails jsonb,
    country text
  )
  ON CONFLICT (artist_key) DO UPDATE
    SET display_name = COALESCE(EXCLUDED.display_name, public.artists.display_name),
        normalized_name = COALESCE(EXCLUDED.normalized_name, public.artists.normalized_name),
        youtube_channel_id = COALESCE(EXCLUDED.youtube_channel_id, public.artists.youtube_channel_id),
        subscriber_count = COALESCE(EXCLUDED.subscriber_count, public.artists.subscriber_count),
        view_count = COALESCE(EXCLUDED.view_count, public.artists.view_count),
        thumbnails = COALESCE(EXCLUDED.thumbnails, public.artists.thumbnails),
        country = COALESCE(EXCLUDED.country, public.artists.country),
        updated_at = now();

  -- Albums
  INSERT INTO public.albums (external_id, title, artist_key, thumbnail_url, release_date, track_count, total_duration_seconds, updated_at)
  SELECT
    al.external_id,
    al.title,
    al.artist_key,
    al.thumbnail_url,
    al.release_date,
    al.track_count,
    al.total_duration_seconds,
    now()
  FROM jsonb_to_recordset(COALESCE(p_albums, '[]'::jsonb)) AS al(
    external_id text,
    title text,
    artist_key text,
    thumbnail_url text,
    release_date date,
    track_count integer,
    total_duration_seconds integer
  )
  WHERE al.external_id IS NOT NULL AND al.external_id <> ''
  ON CONFLICT (external_id) DO UPDATE
    SET title = COALESCE(EXCLUDED.title, public.albums.title),
        artist_key = COALESCE(EXCLUDED.artist_key, public.albums.artist_key),
        thumbnail_url = COALESCE(EXCLUDED.thumbnail_url, public.albums.thumbnail_url),
        release_date = COALESCE(EXCLUDED.release_date, public.albums.release_date),
        track_count = COALESCE(EXCLUDED.track_count, public.albums.track_count),
        total_duration_seconds = COALESCE(EXCLUDED.total_duration_seconds, public.albums.total_duration_seconds),
        updated_at = now();

  -- Tracks
  INSERT INTO public.tracks (youtube_id, title, artist, artist_key, artist_channel_id, album_id, duration, cover_url, image_url, published_at, region, category, sync_status, last_synced_at, last_updated_at)
  SELECT
    t.youtube_id,
    t.title,
    t.artist,
    t.artist_key,
    t.artist_channel_id,
    (SELECT id FROM public.albums WHERE external_id = t.album_external_id LIMIT 1),
    t.duration,
    t.cover_url,
    t.image_url,
    t.published_at,
    t.region,
    t.category,
    'active',
    now(),
    now()
  FROM jsonb_to_recordset(COALESCE(p_tracks, '[]'::jsonb)) AS t(
    youtube_id text,
    title text,
    artist text,
    artist_key text,
    artist_channel_id text,
    album_external_id text,
    duration integer,
    cover_url text,
    image_url text,
    published_at timestamptz,
    region text,
    category text
  )
  WHERE t.youtube_id IS NOT NULL AND t.youtube_id <> ''
  ON CONFLICT (youtube_id) DO UPDATE
    SET title = COALESCE(EXCLUDED.title, public.tracks.title),
        artist = COALESCE(EXCLUDED.artist, public.tracks.artist),
        artist_key = COALESCE(EXCLUDED.artist_key, public.tracks.artist_key),
        artist_channel_id = COALESCE(EXCLUDED.artist_channel_id, public.tracks.artist_channel_id),
        album_id = COALESCE(EXCLUDED.album_id, public.tracks.album_id),
        duration = COALESCE(EXCLUDED.duration, public.tracks.duration),
        cover_url = COALESCE(EXCLUDED.cover_url, public.tracks.cover_url),
        image_url = COALESCE(EXCLUDED.image_url, public.tracks.image_url),
        published_at = COALESCE(EXCLUDED.published_at, public.tracks.published_at),
        region = COALESCE(EXCLUDED.region, public.tracks.region),
        category = COALESCE(EXCLUDED.category, public.tracks.category),
        sync_status = 'active',
        last_synced_at = now(),
        last_updated_at = now();

  -- Playlists
  INSERT INTO public.playlists (external_id, title, description, cover_url, image_url, channel_id, item_count, region, country, view_count, quality_score, is_public, last_refreshed_on, last_etag, validated, validated_on)
  SELECT
    p.external_id,
    p.title,
    p.description,
    p.cover_url,
    p.image_url,
    p.channel_id,
    p.item_count,
    p.region,
    p.country,
    p.view_count,
    p.quality_score,
    COALESCE(p.is_public, true),
    now(),
    p.last_etag,
    COALESCE(p.validated, true),
    COALESCE(p.validated_on, now())
  FROM jsonb_to_recordset(COALESCE(p_playlists, '[]'::jsonb)) AS p(
    external_id text,
    title text,
    description text,
    cover_url text,
    image_url text,
    channel_id text,
    item_count integer,
    region text,
    country text,
    view_count integer,
    quality_score numeric,
    is_public boolean,
    last_etag text,
    validated boolean,
    validated_on timestamptz
  )
  WHERE p.external_id IS NOT NULL AND p.external_id <> ''
  ON CONFLICT (external_id) DO UPDATE
    SET title = COALESCE(EXCLUDED.title, public.playlists.title),
        description = COALESCE(EXCLUDED.description, public.playlists.description),
        cover_url = COALESCE(EXCLUDED.cover_url, public.playlists.cover_url),
        image_url = COALESCE(EXCLUDED.image_url, public.playlists.image_url),
        channel_id = COALESCE(EXCLUDED.channel_id, public.playlists.channel_id),
        item_count = COALESCE(EXCLUDED.item_count, public.playlists.item_count),
        region = COALESCE(EXCLUDED.region, public.playlists.region),
        country = COALESCE(EXCLUDED.country, public.playlists.country),
        view_count = COALESCE(EXCLUDED.view_count, public.playlists.view_count),
        quality_score = COALESCE(EXCLUDED.quality_score, public.playlists.quality_score),
        is_public = COALESCE(EXCLUDED.is_public, public.playlists.is_public),
        last_refreshed_on = COALESCE(EXCLUDED.last_refreshed_on, public.playlists.last_refreshed_on),
        last_etag = COALESCE(EXCLUDED.last_etag, public.playlists.last_etag),
        validated = COALESCE(EXCLUDED.validated, public.playlists.validated),
        validated_on = COALESCE(EXCLUDED.validated_on, public.playlists.validated_on),
        updated_at = now();

  -- Playlist-track links
  WITH track_ids AS (
    SELECT t.youtube_id, t.id AS track_id FROM public.tracks t
  ),
  playlist_ids AS (
    SELECT p.external_id, p.id AS playlist_id FROM public.playlists p
  )
  INSERT INTO public.playlist_tracks (playlist_id, track_id, position)
  SELECT
    pi.playlist_id,
    ti.track_id,
    COALESCE(pt.position, 0)
  FROM jsonb_to_recordset(COALESCE(p_playlist_tracks, '[]'::jsonb)) AS pt(
    playlist_external_id text,
    youtube_id text,
    position integer
  )
  JOIN playlist_ids pi ON pi.external_id = pt.playlist_external_id
  JOIN track_ids ti ON ti.youtube_id = pt.youtube_id
  ON CONFLICT (playlist_id, track_id) DO UPDATE SET position = EXCLUDED.position;

  UPDATE public.innertube_raw_payloads
    SET status = 'processed', processed_at = now(), error_message = NULL
    WHERE id = p_payload_id;

END;
$$;

GRANT EXECUTE ON FUNCTION public.ingest_innertube_entities(uuid, jsonb, jsonb, jsonb, jsonb, jsonb) TO service_role;

COMMIT;