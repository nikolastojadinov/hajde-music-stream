-- Add liked_at as an alias/view for created_at to match frontend expectations
-- This migration ensures backward compatibility while maintaining consistency

-- The likes table already has created_at, but the frontend expects liked_at
-- We'll add a generated column that mirrors created_at

-- Note: If you prefer to rename the column instead:
-- ALTER TABLE likes RENAME COLUMN created_at TO liked_at;

-- Or add both (current approach - safer for existing data):
ALTER TABLE likes ADD COLUMN IF NOT EXISTS liked_at timestamptz;

-- Update existing rows to copy created_at to liked_at
UPDATE likes SET liked_at = created_at WHERE liked_at IS NULL;

-- Set default for new rows
ALTER TABLE likes ALTER COLUMN liked_at SET DEFAULT now();

-- Create a trigger to keep them in sync if needed
CREATE OR REPLACE FUNCTION sync_liked_at()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.liked_at IS NULL THEN
    NEW.liked_at := NEW.created_at;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER set_liked_at_on_insert
  BEFORE INSERT ON likes
  FOR EACH ROW
  EXECUTE FUNCTION sync_liked_at();
