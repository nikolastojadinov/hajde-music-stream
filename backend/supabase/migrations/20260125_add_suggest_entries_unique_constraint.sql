-- Deduplicate existing suggest entries to avoid unique constraint violations
with ranked as (
  select
    id,
    row_number() over (
      partition by normalized_query, entity_type, external_id
      order by last_seen_at desc nulls last, ts desc, id desc
    ) as rn
  from public.suggest_entries
)
delete from public.suggest_entries se
using ranked r
where se.id = r.id
  and r.rn > 1;

-- Enforce uniqueness required by ON CONFLICT (normalized_query, entity_type, external_id)
alter table public.suggest_entries
  add constraint suggest_entries_normalized_query_entity_type_external_id_key
  unique (normalized_query, entity_type, external_id);
