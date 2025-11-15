-- COMPLETE FIX for "Could not find the table 'public.users' in the schema cache"
-- Run this ENTIRE script in Supabase SQL Editor

-- Step 1: Verify table exists
SELECT 'Table exists check:' AS step;
SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename = 'users';

-- Step 2: Grant schema usage to anon and authenticated roles
SELECT 'Granting schema permissions...' AS step;
GRANT USAGE ON SCHEMA public TO anon;
GRANT USAGE ON SCHEMA public TO authenticated;
GRANT USAGE ON SCHEMA public TO service_role;

-- Step 3: Grant table permissions
SELECT 'Granting table permissions...' AS step;
GRANT ALL ON TABLE public.users TO anon;
GRANT ALL ON TABLE public.users TO authenticated;
GRANT ALL ON TABLE public.users TO service_role;

-- Step 4: Grant sequence permissions (if any)
SELECT 'Granting sequence permissions...' AS step;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO anon;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO authenticated;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO service_role;

-- Step 5: Drop existing policies
SELECT 'Dropping old policies...' AS step;
DROP POLICY IF EXISTS "Allow all operations" ON public.users;
DROP POLICY IF EXISTS "Allow all operations for authenticated users" ON public.users;
DROP POLICY IF EXISTS "Enable read access for all users" ON public.users;
DROP POLICY IF EXISTS "Enable insert for all users" ON public.users;
DROP POLICY IF EXISTS "Enable update for all users" ON public.users;
DROP POLICY IF EXISTS "Enable delete for all users" ON public.users;

-- Step 6: Ensure RLS is enabled
SELECT 'Enabling RLS...' AS step;
ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;

-- Step 7: Create comprehensive RLS policies
SELECT 'Creating RLS policies...' AS step;

-- SELECT policy
CREATE POLICY "Enable read access for all users"
ON public.users
FOR SELECT
TO anon, authenticated, service_role
USING (true);

-- INSERT policy
CREATE POLICY "Enable insert for all users"
ON public.users
FOR INSERT
TO anon, authenticated, service_role
WITH CHECK (true);

-- UPDATE policy
CREATE POLICY "Enable update for all users"
ON public.users
FOR UPDATE
TO anon, authenticated, service_role
USING (true)
WITH CHECK (true);

-- DELETE policy
CREATE POLICY "Enable delete for all users"
ON public.users
FOR DELETE
TO anon, authenticated, service_role
USING (true);

-- Step 8: Verify user exists and update password
SELECT 'Verifying user data...' AS step;
SELECT 
  id,
  username,
  email,
  name,
  base_role,
  password_hash,
  is_super_admin
FROM public.users
WHERE email = 'superadmin@ucu.ac.ug';

-- Update password if user exists
UPDATE public.users
SET password_hash = 'admin123'
WHERE email = 'superadmin@ucu.ac.ug';

-- Step 9: Test query (this helps refresh the schema cache)
SELECT 'Testing query (refreshing cache)...' AS step;
SELECT COUNT(*) as user_count FROM public.users;

-- Step 10: Verify policies
SELECT 'Verifying policies...' AS step;
SELECT 
  policyname,
  permissive,
  roles,
  cmd
FROM pg_policies
WHERE schemaname = 'public' AND tablename = 'users';

-- Step 11: Final verification
SELECT 'Final verification - user data:' AS step;
SELECT 
  id,
  email,
  name,
  base_role,
  is_super_admin,
  password_hash
FROM public.users
WHERE email = 'superadmin@ucu.ac.ug';

SELECT '✅ Fix complete! Try logging in now.' AS status;





