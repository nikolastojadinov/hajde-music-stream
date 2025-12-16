BEGIN;

-- Required for backend upsert:
-- supabase.from('playlist_likes').upsert(..., { onConflict: 'user_id,playlist_id' })
-- Postgres needs a UNIQUE constraint or UNIQUE index on (user_id, playlist_id).

CREATE UNIQUE INDEX IF NOT EXISTS playlist_likes_user_playlist_unique
  ON public.playlist_likes (user_id, playlist_id);

COMMIT;
