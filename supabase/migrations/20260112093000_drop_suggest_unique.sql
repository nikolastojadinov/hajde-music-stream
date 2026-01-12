BEGIN;

-- Remove uniqueness to allow multiple rows per prefix/entity
DROP INDEX IF EXISTS suggest_entries_query_unique;

-- Optional non-unique index to accelerate prefix lookups
CREATE INDEX IF NOT EXISTS idx_suggest_normalized_query_ts ON public.suggest_entries(normalized_query, ts DESC);

COMMIT;