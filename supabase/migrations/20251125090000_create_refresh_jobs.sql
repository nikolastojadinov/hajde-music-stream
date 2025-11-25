-- Ensure refresh_jobs table exists with correct structure
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables 
    WHERE table_schema = 'public' AND table_name = 'refresh_jobs'
  ) THEN
    CREATE TABLE public.refresh_jobs (
      id UUID PRIMARY KEY,
      slot_index INTEGER NOT NULL,
      type TEXT NOT NULL CHECK (type IN ('prepare', 'run')),
      scheduled_at TIMESTAMP WITH TIME ZONE NOT NULL,
      day_key DATE NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','running','done','error')),
      payload JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
      updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
    );
  END IF;
END $$;

-- Keep updated_at fresh
CREATE OR REPLACE FUNCTION public.refresh_jobs_set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgname = 'refresh_jobs_set_updated_at'
  ) THEN
    CREATE TRIGGER refresh_jobs_set_updated_at
      BEFORE UPDATE ON public.refresh_jobs
      FOR EACH ROW
      EXECUTE FUNCTION public.refresh_jobs_set_updated_at();
  END IF;
END $$;

-- Enable RLS and allow service role full control
ALTER TABLE public.refresh_jobs ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies 
    WHERE policyname = 'Service role manages refresh_jobs'
      AND tablename = 'refresh_jobs'
  ) THEN
    CREATE POLICY "Service role manages refresh_jobs"
      ON public.refresh_jobs
      USING (auth.role() = 'service_role')
      WITH CHECK (auth.role() = 'service_role');
  END IF;
END $$;

-- Allow reads for anon/authenticated if ever needed
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies 
    WHERE policyname = 'Public read refresh_jobs'
      AND tablename = 'refresh_jobs'
  ) THEN
    CREATE POLICY "Public read refresh_jobs"
      ON public.refresh_jobs
      FOR SELECT
      USING (auth.role() IN ('anon', 'authenticated', 'service_role'));
  END IF;
END $$;

-- Explicit grants so service_role never hits permission denied
GRANT USAGE ON SCHEMA public TO service_role;
GRANT ALL PRIVILEGES ON TABLE public.refresh_jobs TO service_role;
GRANT SELECT, INSERT, UPDATE ON TABLE public.refresh_jobs TO authenticated;
GRANT SELECT ON TABLE public.refresh_jobs TO anon;

-- Helpful indexes for scheduler queries
CREATE INDEX IF NOT EXISTS idx_refresh_jobs_status_scheduled_at 
  ON public.refresh_jobs (status, scheduled_at);
CREATE INDEX IF NOT EXISTS idx_refresh_jobs_day_key 
  ON public.refresh_jobs (day_key);
