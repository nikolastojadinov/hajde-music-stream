BEGIN;

-- Add expected columns if missing
ALTER TABLE public.innertube_raw_payloads ADD COLUMN IF NOT EXISTS request_type text;
ALTER TABLE public.innertube_raw_payloads ADD COLUMN IF NOT EXISTS request_key text;

-- Backfill request_type/key from legacy columns when present
UPDATE public.innertube_raw_payloads
SET request_type = COALESCE(request_type, endpoint, source),
    request_key = COALESCE(request_key, query, artist_key)
WHERE request_type IS NULL OR request_key IS NULL;

-- Ensure status has a sane default
ALTER TABLE public.innertube_raw_payloads ALTER COLUMN status SET DEFAULT 'pending';

-- Ensure pending index exists for decoder polling
CREATE INDEX IF NOT EXISTS idx_innertube_raw_pending ON public.innertube_raw_payloads (status, created_at);

COMMIT;