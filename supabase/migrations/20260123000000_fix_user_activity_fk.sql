-- Align user_activity_history foreign key with Pi UID-based identity

-- STEP 1: Drop wrong FK to users.id
ALTER TABLE user_activity_history
DROP CONSTRAINT IF EXISTS user_activity_history_user_id_fkey;

-- STEP 1.5: Drop policies that reference user_id so we can change the column type
DO $$
DECLARE
	pol record;
BEGIN
	FOR pol IN
		SELECT policyname
		FROM pg_policies
		WHERE schemaname = 'public'
			AND tablename = 'user_activity_history'
	LOOP
		EXECUTE format('DROP POLICY IF EXISTS %I ON public.user_activity_history', pol.policyname);
	END LOOP;
END$$;

-- STEP 1.6: Align column type to users.uid (text)
ALTER TABLE user_activity_history
ALTER COLUMN user_id TYPE text USING user_id::text;

-- STEP 2: Ensure users.uid is unique (required for FK)
ALTER TABLE users
DROP CONSTRAINT IF EXISTS users_uid_unique;
ALTER TABLE users
ADD CONSTRAINT users_uid_unique UNIQUE (uid);

-- STEP 3: Recreate FK to users.uid
ALTER TABLE user_activity_history
ADD CONSTRAINT user_activity_history_user_uid_fkey
FOREIGN KEY (user_id)
REFERENCES users(uid)
ON DELETE CASCADE;

-- STEP 3.5: Recreate basic RLS policies (adjust if you had custom logic)
CREATE POLICY user_activity_history_insert_own
ON user_activity_history
FOR INSERT
TO authenticated
WITH CHECK (user_id = auth.uid()::text);

CREATE POLICY user_activity_history_select_own
ON user_activity_history
FOR SELECT
TO authenticated
USING (user_id = auth.uid()::text);

-- STEP 4: Safety check (for manual verification)
-- SELECT
--   tc.constraint_name,
--   kcu.column_name,
--   ccu.table_name AS foreign_table,
--   ccu.column_name AS foreign_column
-- FROM information_schema.table_constraints tc
-- JOIN information_schema.key_column_usage kcu
--   ON tc.constraint_name = kcu.constraint_name
-- JOIN information_schema.constraint_column_usage ccu
--   ON ccu.constraint_name = tc.constraint_name
-- WHERE tc.table_name = 'user_activity_history';
