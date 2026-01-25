create or replace function public.fetch_artist_suggest_candidates(limit_count integer)
returns setof public.artists
language sql
set search_path = public
stable
as $$
  select *
  from public.artists a
  where a.youtube_channel_id is not null
    and a.youtube_channel_id <> ''
    and not exists (
      select 1
      from public.suggest_queries q
      where q.artist_channel_id = a.youtube_channel_id
    )
  order by a.updated_at asc nulls last, a.created_at asc
  limit limit_count;
$$;
