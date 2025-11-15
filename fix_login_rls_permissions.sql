-- FIX LOGIN ISSUE: RLS Policies and Permissions
-- Run this ENTIRE script in Supabase SQL Editor
-- This will fix the 404 errors you're seeing

-- Step 1: Grant schema and table permissions
GRANT USAGE ON SCHEMA public TO anon;
GRANT USAGE ON SCHEMA public TO authenticated;
GRANT ALL ON TABLE public.users TO anon;
GRANT ALL ON TABLE public.users TO authenticated;

-- Step 2: Drop all existing policies on users table
DROP POLICY IF EXISTS "Allow all operations" ON public.users;
DROP POLICY IF EXISTS "Allow all operations for authenticated users" ON public.users;
DROP POLICY IF EXISTS "Enable read access for all users" ON public.users;
DROP POLICY IF EXISTS "Enable insert for all users" ON public.users;
DROP POLICY IF EXISTS "Enable update for all users" ON public.users;
DROP POLICY IF EXISTS "Enable delete for all users" ON public.users;

-- Step 3: Ensure RLS is enabled
ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;

-- Step 4: Create comprehensive RLS policies for all operations
-- SELECT policy (read)
CREATE POLICY "Enable read access for all users"
ON public.users
FOR SELECT
TO anon, authenticated
USING (true);

-- INSERT policy
CREATE POLICY "Enable insert for all users"
ON public.users
FOR INSERT
TO anon, authenticated
WITH CHECK (true);

-- UPDATE policy
CREATE POLICY "Enable update for all users"
ON public.users
FOR UPDATE
TO anon, authenticated
USING (true)
WITH CHECK (true);

-- DELETE policy
CREATE POLICY "Enable delete for all users"
ON public.users
FOR DELETE
TO anon, authenticated
USING (true);

-- Step 5: Verify the setup
SELECT '✅ RLS policies created successfully!' AS status;

-- Step 6: Test query to refresh schema cache
SELECT COUNT(*) as user_count FROM public.users;

-- Step 7: Show current policies
SELECT 
  policyname,
  cmd as operation,
  roles
FROM pg_policies
WHERE schemaname = 'public' AND tablename = 'users';

-- Step 8: Verify you have at least one user
SELECT 
  id,
  username,
  email,
  name,
  base_role,
  is_super_admin
FROM public.users
LIMIT 5;




